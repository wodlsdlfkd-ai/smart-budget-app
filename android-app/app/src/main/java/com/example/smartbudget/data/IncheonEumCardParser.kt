package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class IncheonEumCardParser : CardParser {
    private val TAG = "IncheonEumCardParser"

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {
        try {
            // 인천이음은 title에 "결제 완료 25,000원 오후 8:55"
            // text 첫 줄에 "과일파는최군"
            
            var amount = 0
            var isRefund = title.contains("취소") || text.contains("취소") || title.contains("환불") || text.contains("환불")
            
            val amountMatcher = Pattern.compile("([\\d,]+)원").matcher(title)
            if (amountMatcher.find()) {
                amount = amountMatcher.group(1)?.replace(",", "")?.toIntOrNull() ?: 0
                if (isRefund) amount = -amount
            }

            if (amount == 0 && !isRefund) return null

            // 첫 번째 줄을 가맹점명으로 취급
            val merchant = text.trim().split("\n").firstOrNull()?.trim() ?: "인천이음카드 결제"

            val date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
            val time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())

            Log.d(TAG, "파싱 완료 → 금액=$amount, 가맹점=$merchant, 날짜=$date, 시간=$time")

            return CardTransactionParser.Transaction(
                date = date,
                time = time,
                amount = amount,
                merchant = merchant,
                card = "인천이음카드"
            )

        } catch (e: Exception) {
            Log.e(TAG, "인천이음카드 파싱 실패", e)
            return null
        }
    }
}
