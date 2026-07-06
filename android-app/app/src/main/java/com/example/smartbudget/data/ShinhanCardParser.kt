package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class ShinhanCardParser : CardParser {
    private val TAG = "ShinhanCardParser"

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {
        try {
            val targetText = when {
                bigText.isNotBlank() -> bigText
                textLines.isNotBlank() -> textLines
                else -> text
            }

            var amount = 0
            var merchant = "신한카드 결제"
            var date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
            var time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())
            var isRefund = targetText.contains("취소") || targetText.contains("환불")

            val lines = if (targetText.contains("\n")) {
                targetText.split("\n").map { it.trim() }
            } else {
                // 단일 줄일 경우 " - " 또는 "-" 로 구분될 수 있음
                targetText.split(" - ", "- ").map { it.trim() }
            }

            for (line in lines) {
                if (line.contains("승인금액:")) {
                    val amountMatcher = Pattern.compile("([\\d,]+)").matcher(line)
                    if (amountMatcher.find()) {
                        amount = amountMatcher.group(1)?.replace(",", "")?.toIntOrNull() ?: 0
                        if (isRefund) amount = -amount
                    }
                } else if (line.contains("가맹점명:")) {
                    merchant = line.substringAfter("가맹점명:").trim()
                } else if (line.contains("승인일시:")) {
                    val dtMatcher = Pattern.compile("(\\d{1,2})/(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})").matcher(line)
                    if (dtMatcher.find()) {
                        val month = dtMatcher.group(1)?.padStart(2, '0') ?: "01"
                        val day = dtMatcher.group(2)?.padStart(2, '0') ?: "01"
                        val year = SimpleDateFormat("yyyy", Locale.KOREA).format(Date())
                        date = "$year-$month-$day"
                        
                        val hour = dtMatcher.group(3)?.padStart(2, '0') ?: "00"
                        val minute = dtMatcher.group(4)?.padStart(2, '0') ?: "00"
                        time = "$hour:$minute"
                    }
                }
            }

            // 가맹점명이 단일 줄 알림에서 파싱 안 됐을 경우, 첫 번째 덩어리에서 가맹점(이름)을 추출 시도할 수 있지만
            // 신한카드 단일 줄 포맷: "[신한카드(4651)승인] 임*인 - 승인금액: 73,900원..."
            // 가맹점이 보통 안 나옴.

            if (amount == 0 && !isRefund) return null

            Log.d(TAG, "파싱 완료 → 금액=$amount, 가맹점=$merchant, 날짜=$date, 시간=$time")

            return CardTransactionParser.Transaction(
                date = date,
                time = time,
                amount = amount,
                merchant = merchant,
                card = "신한카드"
            )

        } catch (e: Exception) {
            Log.e(TAG, "신한카드 파싱 실패", e)
            return null
        }
    }
}
