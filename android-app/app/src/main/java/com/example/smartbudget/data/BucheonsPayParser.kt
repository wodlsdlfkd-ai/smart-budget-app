package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class BucheonsPayParser : CardParser {
    private val TAG = "BucheonsPayParser"

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {
        try {
            // 부천페이는 title에 "결제 완료 11,000원", text에 "소문난양평해장국  부천페이 추가형 인센티브 1,000원 ..." 구조
            
            var amount = 0
            val amountMatcher = Pattern.compile("([\\d,]+)원").matcher(title)
            if (amountMatcher.find()) {
                amount = amountMatcher.group(1)?.replace(",", "")?.toIntOrNull() ?: 0
            }

            if (amount == 0) return null

            // 첫 번째 단어를 가맹점명으로 취급
            val merchant = text.trim().split("\\s+".toRegex()).firstOrNull() ?: "부천페이 가맹점"

            val date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
            val time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())

            Log.d(TAG, "파싱 완료 → 금액=$amount, 가맹점=$merchant, 날짜=$date, 시간=$time")

            return CardTransactionParser.Transaction(
                date = date,
                time = time,
                amount = amount,
                merchant = merchant,
                card = "부천페이"
            )

        } catch (e: Exception) {
            Log.e(TAG, "부천페이 파싱 실패", e)
            return null
        }
    }
}
