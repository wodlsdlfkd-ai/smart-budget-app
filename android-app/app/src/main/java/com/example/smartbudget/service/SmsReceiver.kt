package com.example.smartbudget.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.example.smartbudget.data.CardTransactionParser
import com.example.smartbudget.data.SettingsRepository
import com.example.smartbudget.data.WebhookSender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 카드사 SMS 메시지를 수신하는 BroadcastReceiver.
 * 
 * 일부 카드사(특히 문자 알림 서비스)는 푸시 알림 대신 SMS로
 * 결제 내역을 보내기 때문에, SMS도 함께 감지합니다.
 */
class SmsReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmsReceiver"
        
        // 카드사 SMS 발신번호 키워드
        val CARD_SMS_SENDERS = listOf(
            "신한", "농협", "현대", "하나", "이음", "부천"
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        
        for (sms in messages) {
            val sender = sms.displayOriginatingAddress ?: ""
            val body = sms.messageBody ?: ""
            
            Log.d(TAG, "SMS 수신: [$sender] $body")
            
            // 카드사 관련 SMS인지 확인
            val isCardSms = CARD_SMS_SENDERS.any { keyword ->
                sender.contains(keyword) || body.contains(keyword)
            }
            
            if (!isCardSms) continue
            
            // 결제 관련 키워드 확인
            val hasPaymentKeyword = CardNotificationListener.PAYMENT_KEYWORDS.any { body.contains(it) }
            if (!hasPaymentKeyword) continue
            
            Log.i(TAG, "카드 결제 SMS 감지: $body")
            
            // 파싱 및 전송
            val transaction = CardTransactionParser.parse(body, "sms:$sender")
            if (transaction != null) {
                CoroutineScope(Dispatchers.IO).launch {
                    val webhookUrl = SettingsRepository.getWebhookUrl(context)
                    if (webhookUrl.isNotBlank()) {
                        WebhookSender.send(webhookUrl, transaction)
                    }
                }
            }
        }
    }
}
