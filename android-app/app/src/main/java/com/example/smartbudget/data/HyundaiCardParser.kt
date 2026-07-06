package com.example.smartbudget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class HyundaiCardParser : CardParser {
    private val TAG = "HyundaiCardParser"
    private val AMOUNT_PATTERN = Pattern.compile("([\\d,]+)원")
    // 날짜+시간: "7/1 18:17" 형태 또는 "07/01 18:17" 형태
    private val DATE_TIME_PATTERN = Pattern.compile("(\\d{1,2})/(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})")

    override fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction? {

        // 현대카드 알림 형식:
        // [접힌 text 한 줄]
        //   "임재인 님, 네이버 현대카드 승인 23,700원 일시불, 7/1 18:17"
        //
        // [펼친 bigText 여러 줄]
        //   "현대카드"                                         ← lines[0]: 카드사명, 금액 없음
        //   "임재인 님, 네이버 현대카드 승인 23,700원 일시불, 7/1 18:17"  ← lines[1]: 금액+날짜
        //   "그레이핌폴중동미리내점"                             ← lines[2]: 가맹점
        //   "누적93,700원"                                     ← lines[3]: 누적금액 (무시)

        // bigText(펼침) 우선, 없으면 text(접힘) 사용
        val targetText = when {
            bigText.contains("\n") -> bigText
            bigText.isNotBlank() -> bigText
            textLines.isNotBlank() -> textLines
            else -> text
        }

        if (targetText.isBlank()) return null

        val lines = targetText.split("\n").map { it.trim() }.filter { it.isNotBlank() }
        if (lines.isEmpty()) return null

        // ─── 금액 추출 ─────────────────────────────────────────────
        // "현대카드" 같은 카드사명만 있는 줄을 건너뛰고, 금액이 있는 줄에서 추출
        var amount = 0
        var amountLineIndex = -1
        for ((idx, line) in lines.withIndex()) {
            val m = AMOUNT_PATTERN.matcher(line)
            if (m.find()) {
                val candidate = m.group(1)?.replace(",", "")?.toIntOrNull() ?: 0
                // "누적93700원" 같은 누적금액 줄은 제외
                if (!line.contains("누적") && candidate > 0) {
                    amount = candidate
                    amountLineIndex = idx
                    break
                }
            }
        }

        if (amount == 0) return null

        // 취소 처리
        if (targetText.contains("취소")) amount = -amount

        // ─── 날짜/시간 추출 ───────────────────────────────────────
        var date = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
        var time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date())

        // 금액이 있던 줄(또는 전체 텍스트)에서 날짜/시간 찾기
        val searchForDateTime = if (amountLineIndex >= 0) lines[amountLineIndex] else targetText
        val dtMatcher = DATE_TIME_PATTERN.matcher(searchForDateTime)
        if (dtMatcher.find()) {
            val month = dtMatcher.group(1)?.padStart(2, '0') ?: "01"
            val day = dtMatcher.group(2)?.padStart(2, '0') ?: "01"
            val year = SimpleDateFormat("yyyy", Locale.KOREA).format(Date())
            date = "$year-$month-$day"
            val hour = dtMatcher.group(3)?.padStart(2, '0') ?: "00"
            val minute = dtMatcher.group(4)?.padStart(2, '0') ?: "00"
            time = "$hour:$minute"
        }

        // ─── 가맹점 추출 ──────────────────────────────────────────
        // 금액+날짜 줄 바로 다음 줄이 가맹점명. 누적금액 줄은 제외.
        var merchant = "알 수 없는 가맹점"
        if (amountLineIndex >= 0) {
            // 금액 줄 이후에서 "누적" 없는 첫 줄 = 가맹점
            val afterAmount = lines.drop(amountLineIndex + 1)
            val merchantLine = afterAmount.firstOrNull {
                !it.contains("누적") && !it.contains("현대카드") && it.isNotBlank()
            }
            if (merchantLine != null) {
                merchant = merchantLine
            }
        }

        Log.d(TAG, "현대카드 파싱 완료 → 금액=$amount, 가맹점=$merchant, 날짜=$date, 시간=$time")

        return CardTransactionParser.Transaction(
            card = "현대카드",
            amount = amount,
            merchant = merchant,
            date = date,
            time = time
        )
    }
}
