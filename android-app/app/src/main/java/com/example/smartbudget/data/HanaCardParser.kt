package com.example.smartbudget.data

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class HanaCardParser : CardParser {
    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {
        // 텍스트 중복을 피하기 위해 가장 정보가 많은 것 하나만 선택
        val targetText = listOf(textLines, bigText, text).firstOrNull { it.isNotBlank() } ?: ""
        val rawText = "$title $targetText"
        
        if (rawText.trim().isBlank()) return null

        // 1. Amount
        // Title format: (결제) 5,650원 or (취소) 5,650원
        val amountString = title.replace(Regex("[^0-9]"), "")
        var amount = amountString.toIntOrNull() ?: 0

        // 타이틀에 금액이 없는 경우 본문에서 금액 추출 시도
        if (amount == 0) {
            val amountMatcher = java.util.regex.Pattern.compile("([\\d,]+)\\s*원").matcher(rawText)
            if (amountMatcher.find()) {
                amount = amountMatcher.group(1)?.replace(",", "")?.toIntOrNull() ?: 0
            }
        }

        // If title contains "취소", negate the amount (income)
        if (title.contains("취소") || rawText.contains("취소")) {
            amount = -amount
        }

        // 2. Merchant & Date/Time
        // Text format: 쿠팡 / 신용(일시불,0*7*) / 07.01 11:49 / 누적이용금액 18,830원
        if (!rawText.contains("/")) {
            // 슬래시 구분이 없는 접힌 알림(실시간) 형태 처리
            val fallbackMerchant = text.trim().split("\\s+".toRegex()).firstOrNull() ?: "알 수 없는 가맹점"
            val cleanMerchant = fallbackMerchant.replace(Regex("\\(결제\\)|\\(취소\\)|[\\d,]+\\s*원|하나카드|하나pay"), "").trim()
            
            return CardTransactionParser.Transaction(
                card = "하나카드",
                amount = amount,
                merchant = if (cleanMerchant.isBlank()) "알 수 없는 가맹점" else cleanMerchant,
                date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date()),
                time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())
            )
        }

        val parts = rawText.split("/")
        var merchant = if (parts.isNotEmpty()) {
            parts[0].trim()
        } else {
            "기타"
        }
        
        // title에서 넘어온 (결제) 3,500원 같은 텍스트 제거
        merchant = merchant.replace(Regex("\\(결제\\)|\\(취소\\)|[\\d,]+\\s*원|하나카드|하나pay"), "").trim()
        
        if (merchant.isBlank()) merchant = "알 수 없는 가맹점"

        var date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
        var time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())

        if (parts.size >= 3) {
            val dateTimeStr = parts[2].trim() // "07.01 11:49"
            val dtParts = dateTimeStr.split(" ")
            if (dtParts.size == 2) {
                val year = SimpleDateFormat("yyyy", Locale.KOREA).format(Date())
                date = "$year-${dtParts[0].replace(".", "-")}"
                time = dtParts[1]
            }
        }

        return CardTransactionParser.Transaction(
            card = "하나카드",
            amount = amount,
            merchant = merchant,
            date = date,
            time = time
        )
    }
}
