package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

/**
 * 카드 결제 알림 텍스트를 파싱하여 구조화된 데이터로 변환합니다.
 * 
 * 지원하는 카드사 알림 형식 예시:
 * - "[신한카드] 홍길동님 12,000원 결제 스타벅스강남점 06/28 14:30"
 * - "NH농협 홍길동님 카드승인 15,000원 한솥도시락 06/28 15:00"
 * - "[현대카드] 승인 8,500원 CU편의점 06/28 16:20"
 * - "[하나카드] 홍길동님 승인 30,000원 올리브영 06/28 17:00"
 */
object CardTransactionParser {

    private const val TAG = "CardTxParser"

    /**
     * 파싱된 거래 데이터
     */
    data class Transaction(
        val date: String,       // "2026-06-28"
        val time: String,       // "14:30"
        val amount: Int,        // 12000
        val merchant: String,   // "스타벅스강남점"
        val card: String        // "신한카드"
    )

    // 금액 패턴: 숫자 + 원 (쉼표 포함 가능)
    private val AMOUNT_PATTERN = Pattern.compile("([\\d,]+)\\s*원")
    
    // 시간 패턴: HH:MM 또는 HH시MM분
    private val TIME_PATTERN = Pattern.compile("(\\d{1,2}):(\\d{2})")
    
    // 날짜 패턴: MM/DD 또는 MM-DD 또는 M월D일
    private val DATE_PATTERN = Pattern.compile("(\\d{1,2})[/\\-월](\\d{1,2})[일]?")

    // 카드사 식별 패턴 (텍스트 폴백용)
    private val CARD_PATTERNS = mapOf(
        "신한카드" to "신한카드",
        "NH농협카드" to "NH농협카드",
        "현대카드" to "현대카드",
        "하나카드" to "하나카드",
        "인천이음" to "인천이음카드",
        "이음카드" to "인천이음카드",
        "부천페이" to "부천페이",
        "코나카드" to "코나카드",
        "KB국민" to "KB국민카드",
        "국민카드" to "KB국민카드"
    )

    // 카드사별 전용 파서 매핑
    private val PARSERS = mapOf(
        "NH농협카드" to NhCardParser(),
        "농협" to NhCardParser(),
        "nh" to NhCardParser(),
        "하나카드" to HanaCardParser(),
        "하나" to HanaCardParser(),
        "hana" to HanaCardParser(),
        "현대카드" to HyundaiCardParser(),
        "현대" to HyundaiCardParser(),
        "hyundai" to HyundaiCardParser(),
        "신한카드" to ShinhanCardParser(),
        "shinhan" to ShinhanCardParser(),
        "부천페이" to BucheonsPayParser(),
        "gyeonggi" to BucheonsPayParser(),
        "인천이음카드" to IncheonEumCardParser(),
        "인천이음" to IncheonEumCardParser(),
        "zzeung" to IncheonEumCardParser(),
        "iche" to IncheonEumCardParser()
    )

    /**
     * 알림 객체의 각 필드를 받아 적절한 파서로 라우팅합니다.
     */
    fun parseNotification(
        packageName: String,
        title: String,
        text: String,
        bigText: String,
        textLines: String,
        fullTextFallback: String
    ): Transaction? {
        val cardName = identifyCard(fullTextFallback, packageName)

        // 1) 전용 파서가 있는지 확인
        val parser = PARSERS[cardName] ?: PARSERS.entries.find { cardName.contains(it.key, ignoreCase = true) }?.value

        if (parser != null) {
            val transaction = parser.parse(title, text, bigText, textLines)
            if (transaction != null) {
                return transaction
            }
        }

        // 2) 전용 파서가 없거나 실패한 경우 기존 범용 파서(fallback) 사용
        // 범용 파서에서도 취소/환불인지 체크하여 음수로 처리하는 로직 추가
        var amount = extractAmount(fullTextFallback) ?: return null
        if (fullTextFallback.contains("취소") || fullTextFallback.contains("환불") || fullTextFallback.contains("-")) {
            amount = -amount
        }
        
        val date = extractDate(fullTextFallback)
        val time = extractTime(fullTextFallback)
        val merchant = extractMerchant(fullTextFallback, amount, cardName)
        
        return Transaction(
            date = date,
            time = time,
            amount = amount,
            merchant = merchant,
            card = cardName
        )
    }

    /**
     * 알림 텍스트를 파싱하여 Transaction 객체를 반환합니다.
     * 파싱에 실패하면 null을 반환합니다. (기존 하위 호환성 유지)
     */
    fun parse(text: String, packageName: String = ""): Transaction? {
        try {
            // 1) 금액 추출
            var amount = extractAmount(text) ?: return null
            
            // 2) 카드사 식별
            val card = identifyCard(text, packageName)
            
            // 3) 날짜 & 시간 추출
            val date = extractDate(text)
            val time = extractTime(text)
            
            // 4) 가맹점명 추출
            val merchant = extractMerchant(text, amount, card)
            
            // 범용 파서에서도 취소/환불인지 체크하여 음수로 처리
            if (text.contains("취소") || text.contains("환불") || text.contains("-")) {
                amount = -amount
            }

            return Transaction(
                date = date,
                time = time,
                amount = amount,
                merchant = merchant,
                card = card
            )
        } catch (e: Exception) {
            Log.e(TAG, "파싱 중 오류: ${e.message}", e)
            return null
        }
    }

    /**
     * 금액 추출 (쉼표 제거, 정수 변환)
     */
    private fun extractAmount(text: String): Int? {
        val matcher = AMOUNT_PATTERN.matcher(text)
        if (matcher.find()) {
            val amountStr = matcher.group(1)?.replace(",", "") ?: return null
            return amountStr.toIntOrNull()
        }
        return null
    }

    /**
     * 카드사 식별 (텍스트 내 키워드 또는 패키지명 기반)
     */
    private fun identifyCard(text: String, packageName: String): String {
        // 1. 패키지명 기반 매칭 (우선순위 1)
        val packageBasedCard = when {
            packageName.contains("shinhan") -> "신한카드"
            packageName.contains("nh") || packageName.contains("nonghyup") -> "NH농협카드"
            packageName.contains("hyundai") -> "현대카드"
            packageName.contains("hana") -> "하나카드"
            packageName.contains("zzeung") || packageName.contains("iche") -> "인천이음카드"
            packageName.contains("kbstar") || packageName.contains("kbcard") -> "KB국민카드"
            packageName.contains("konai") -> "코나카드"
            packageName.contains("gyeonggi") -> {
                // 경기지역화폐는 앱 하나로 여러 지자체 페이를 관리하므로 텍스트로 보완
                if (text.contains("부천페이")) "부천페이"
                else if (text.contains("수원페이")) "수원페이"
                else if (text.contains("김포페이")) "김포페이"
                else "경기지역화폐"
            }
            else -> null
        }
        
        if (packageBasedCard != null) return packageBasedCard

        // 2. 텍스트 기반 매칭 (우선순위 2 - SMS 문자 등)
        for ((keyword, cardName) in CARD_PATTERNS) {
            if (text.contains(keyword)) return cardName
        }
        
        return "기타카드"
    }

    /**
     * 날짜 추출 (없으면 오늘 날짜)
     */
    private fun extractDate(text: String): String {
        val matcher = DATE_PATTERN.matcher(text)
        if (matcher.find()) {
            val month = matcher.group(1)?.padStart(2, '0') ?: "01"
            val day = matcher.group(2)?.padStart(2, '0') ?: "01"
            val year = SimpleDateFormat("yyyy", Locale.KOREA).format(Date())
            return "$year-$month-$day"
        }
        // 날짜가 없으면 오늘 날짜
        return SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
    }

    /**
     * 시간 추출 (없으면 현재 시간)
     */
    private fun extractTime(text: String): String {
        val matcher = TIME_PATTERN.matcher(text)
        if (matcher.find()) {
            val hour = matcher.group(1)?.padStart(2, '0') ?: "00"
            val minute = matcher.group(2)?.padStart(2, '0') ?: "00"
            return "$hour:$minute"
        }
        return SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())
    }

    /**
     * 가맹점명 추출
     * 금액, 카드사명, 날짜/시간 등을 제거한 후 남은 텍스트에서 추출합니다.
     */
    private fun extractMerchant(text: String, amount: Int, card: String): String {
        var cleaned = text
        
        // 불필요한 부분 제거
        val removePatterns = listOf(
            "\\[.*?\\]",                    // [신한카드] 등 대괄호
            "\\d{1,2}[/\\-월]\\d{1,2}[일]?", // 날짜
            "\\d{1,2}:\\d{2}",              // 시간
            "[\\d,]+\\s*원",                // 금액
            "님",                           // 존칭
            "승인금액|결제금액|금액|승인|결제|사용|출금|이용|카드|누적|잔액", // 키워드
            "일시불|할부",                   // 결제 방식
            "오전|오후",                     // 시간 키워드
            "\\*+",                         // 마스킹 문자
            "[\\-\\:\\/\\,]",               // 특수문자 (- : / ,)
            "\\(.*?\\)",                    // 괄호 안의 내용 모두 제거
            "\\s{2,}",                      // 연속 공백
        )
        
        for (pattern in removePatterns) {
            cleaned = cleaned.replace(Regex(pattern), " ")
        }
        
        // 카드사 키워드 제거
        for ((keyword, _) in CARD_PATTERNS) {
            cleaned = cleaned.replace(keyword, " ")
        }
        
        // 이름(2~4글자 한글) 제거 시도
        cleaned = cleaned.replace(Regex("[가-힣]{2,4}(?=\\s)"), " ")
        
        // 정리 후 남은 의미 있는 텍스트 추출
        val trimmed = cleaned.trim().replace(Regex("\\s+"), " ").trim()
        
        return if (trimmed.isNotBlank()) trimmed else "알 수 없는 가맹점"
    }
}
