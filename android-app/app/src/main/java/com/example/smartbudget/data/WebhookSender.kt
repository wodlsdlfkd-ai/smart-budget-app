package com.example.smartbudget.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 파싱된 결제 데이터를 Google Apps Script 웹훅으로 전송합니다.
 */
object WebhookSender {

    private const val TAG = "WebhookSender"
    private const val TIMEOUT_MS = 15000

    /**
     * 거래 데이터를 웹훅 URL로 POST 전송합니다.
     * 
     * @param webhookUrl Apps Script 배포 URL
     * @param transaction 파싱된 거래 데이터
     * @return 전송 성공 여부
     */
    suspend fun send(
        webhookUrl: String,
        transaction: CardTransactionParser.Transaction
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val json = JSONObject().apply {
                put("date", transaction.date)
                put("time", transaction.time)
                put("amount", transaction.amount)
                put("merchant", transaction.merchant)
                put("card", transaction.card)
            }

            Log.d(TAG, "전송 시도: $json")

            val url = URL(webhookUrl)
            val connection = url.openConnection() as HttpURLConnection
            
            connection.apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                doOutput = true
                // Apps Script 리다이렉트 따라가기
                instanceFollowRedirects = true
            }

            // JSON 데이터 전송
            OutputStreamWriter(connection.outputStream, "UTF-8").use { writer ->
                writer.write(json.toString())
                writer.flush()
            }

            val responseCode = connection.responseCode
            val responseBody = try {
                connection.inputStream.bufferedReader().readText()
            } catch (e: Exception) {
                connection.errorStream?.bufferedReader()?.readText() ?: ""
            }

            connection.disconnect()

            if (responseCode in 200..399) {
                Log.i(TAG, "전송 성공: ${transaction.card} ${transaction.amount}원 ${transaction.merchant}")
                Log.d(TAG, "서버 응답: $responseBody")
                true
            } else {
                Log.e(TAG, "전송 실패 (HTTP $responseCode): $responseBody")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "전송 중 오류: ${e.message}", e)
            false
        }
    }
}
