package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class NhCardParser : CardParser {
    private val TAG = "NhCardParser"
    private val AMOUNT_PATTERN = Pattern.compile("([\\d,]+)\\s*원")
    private val DATE_TIME_PATTERN = Pattern.compile("(\\d{1,2})[/\\-](\\d{1,2})\\s+(\\d{1,2}):(\\d{2})")

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {
        try {
            // NH농협 알림 우선순위:
            // bigText → 펼친 상태의 전체 내용 (줄바꿈 포함), 가장 풍부한 정보
            // text    → 접힌 상태의 한 줄 요약 → 공백 split 금지!
            // textLines → 보통 비어있음

            // bigText가 개행 포함 시 최우선 사용
            val targetText: String = when {
                bigText.contains("\n") -> bigText
                textLines.contains("\n") -> textLines
                bigText.isNotBlank() -> bigText
                textLines.isNotBlank() -> textLines
                else -> {
                    // text는 한 줄 요약이라 공백 split 하면 엉망이 됨.
                    // 대신 정규식으로만 필요한 정보를 추출한다.
                    return parseFromSingleLine(text)
                }
            }

            val lines = targetText.split("\n").map { it.trim() }.filter { it.isNotBlank() }

            var amount = 0
            var isRefund = false
            var date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
            var time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())

            val fullText = lines.joinToString(" ")
            if (fullText.contains("취소") || fullText.contains("환불")) {
                isRefund = true
            }

            val merchantCandidates = mutableListOf<String>()

            for (line in lines) {
                // 금액 라인 (예: "21,580원 일시불")
                val amountMatcher = AMOUNT_PATTERN.matcher(line)
                if (amountMatcher.find()) {
                    val amountStr = amountMatcher.group(1)?.replace(",", "") ?: "0"
                    amount = amountStr.toIntOrNull() ?: 0
                    if (isRefund) amount = -amount
                    continue
                }

                // 날짜+시간 라인 (예: "07/02 10:53")
                val dateTimeMatcher = DATE_TIME_PATTERN.matcher(line)
                if (dateTimeMatcher.find()) {
                    val month = dateTimeMatcher.group(1)?.padStart(2, '0') ?: "01"
                    val day = dateTimeMatcher.group(2)?.padStart(2, '0') ?: "01"
                    val year = SimpleDateFormat("yyyy", Locale.KOREA).format(Date())
                    date = "$year-$month-$day"
                    val hour = dateTimeMatcher.group(3)?.padStart(2, '0') ?: "00"
                    val minute = dateTimeMatcher.group(4)?.padStart(2, '0') ?: "00"
                    time = "$hour:$minute"
                    continue
                }

                // 필터: NH카드사 식별 텍스트, 마스킹 이름, 결제 상태 키워드 제거
                if (line.contains("NH") || line.contains("농협") || line.contains("카드")) continue
                if (line.contains("*")) continue  // 마스킹된 이름 (임*인 등)
                if (line == "승인" || line == "취소" || line == "일시불" || line == "할부") continue
                if (line.matches(Regex("\\d{1,2}할부"))) continue  // 3할부 등

                // 살아남은 텍스트 = 가맹점명 후보
                merchantCandidates.add(line)
            }

            if (amount == 0 && !isRefund) return null

            // NH농협 bigText는 마지막 줄이 가맹점명 (예: 네이버페이)
            val merchant = if (merchantCandidates.isNotEmpty()) {
                merchantCandidates.last()
            } else {
                "알 수 없는 가맹점"
            }

            Log.d(TAG, "파싱 완료 → 금액=$amount, 가맹점=$merchant, 날짜=$date, 시간=$time")

            return CardTransactionParser.Transaction(
                date = date,
                time = time,
                amount = amount,
                merchant = merchant,
                card = "NH농협카드"
            )

        } catch (e: Exception) {
            Log.e(TAG, "NH농협카드 파싱 실패", e)
            return null
        }
    }

    /**
     * bigText 없이 text 한 줄만 있을 때 정규식으로 파싱 시도.
     * 예: "NH카드0*7*승인 임*인 21,580원 일시불 07/02 10:53 네이버페이"
     */
    private fun parseFromSingleLine(text: String): CardTransactionParser.Transaction? {
        if (text.isBlank()) return null

        val amountMatcher = AMOUNT_PATTERN.matcher(text)
        val amount = if (amountMatcher.find()) {
            amountMatcher.group(1)?.replace(",", "")?.toIntOrNull() ?: return null
        } else return null

        val isRefund = text.contains("취소") || text.contains("환불")
        val finalAmount = if (isRefund) -amount else amount

        // 날짜+시간 추출 (MM/DD HH:MM 형태)
        val dtPattern = Pattern.compile("(\\d{1,2})/(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})")
        val dtMatcher = dtPattern.matcher(text)
        val year = SimpleDateFormat("yyyy", Locale.KOREA).format(Date())
        var date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
        var time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())
        var afterEndIndex = 0
        if (dtMatcher.find()) {
            val month = dtMatcher.group(1)?.padStart(2, '0') ?: "01"
            val day = dtMatcher.group(2)?.padStart(2, '0') ?: "01"
            date = "$year-$month-$day"
            val hour = dtMatcher.group(3)?.padStart(2, '0') ?: "00"
            val minute = dtMatcher.group(4)?.padStart(2, '0') ?: "00"
            time = "$hour:$minute"
            afterEndIndex = dtMatcher.end()
        }

        // 날짜/시간 이후의 마지막 토큰이 가맹점명
        val afterDateTime = if (afterEndIndex > 0) text.substring(afterEndIndex).trim() else ""
        val merchant = afterDateTime.split(" ").filter { it.isNotBlank() }.lastOrNull()?.trim()
            ?: "알 수 없는 가맹점"

        return CardTransactionParser.Transaction(
            date = date,
            time = time,
            amount = finalAmount,
            merchant = merchant,
            card = "NH농협카드"
        )
    }
}
