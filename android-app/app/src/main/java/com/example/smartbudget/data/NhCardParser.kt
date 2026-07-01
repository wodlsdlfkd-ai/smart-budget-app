package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class NhCardParser : CardParser {
    private val TAG = "NhCardParser"
    private val AMOUNT_PATTERN = Pattern.compile("([\\d,]+)\\s*원")
    private val DATE_TIME_PATTERN = Pattern.compile("(\\d{1,2})[/\\-월](\\d{1,2}).*?(\\d{1,2}):(\\d{2})")

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {
        try {
            // 농협카드는 textLines 또는 bigText에 알람 내용이 여러 줄로 나뉘어 들어옴.
            val targetText = if (textLines.isNotBlank()) textLines else bigText
            if (targetText.isBlank()) return null

            // 줄 단위로 분리
            val lines = targetText.split("\n").map { it.trim() }.filter { it.isNotBlank() }
            
            var amount = 0
            var isRefund = false
            var date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
            var time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())
            
            // 전체 텍스트에서 취소/환불 키워드 검사
            val fullText = lines.joinToString(" ")
            if (fullText.contains("취소") || fullText.contains("환불") || fullText.contains("-")) {
                isRefund = true
            }

            // 가맹점명 후보 추출을 위해 걸러낼 조건
            val merchantCandidates = mutableListOf<String>()

            for (line in lines) {
                // 금액 라인
                val amountMatcher = AMOUNT_PATTERN.matcher(line)
                if (amountMatcher.find()) {
                    val amountStr = amountMatcher.group(1)?.replace(",", "") ?: "0"
                    amount = amountStr.toIntOrNull() ?: 0
                    if (isRefund) amount = -amount
                    continue
                }

                // 날짜/시간 라인
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

                // 카드사 이름, 마스킹(임*인 등), 결제상태 등의 키워드가 포함된 라인 제외
                if (line.contains("NH") || line.contains("농협") || line.contains("카드")) continue
                if (line.contains("*")) continue
                if (line == "승인" || line == "취소" || line == "일시불" || line == "할부") continue

                // 위의 조건에 모두 걸리지 않았다면 상호명일 확률이 높음
                merchantCandidates.add(line)
            }

            if (amount == 0 && !isRefund) {
                return null
            }

            val merchant = if (merchantCandidates.isNotEmpty()) {
                merchantCandidates.last() // 가장 마지막에 남은 유효한 텍스트가 주로 가맹점명
            } else {
                "알 수 없는 가맹점"
            }

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
}
