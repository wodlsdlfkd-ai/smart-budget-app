package com.example.smartbudget.service

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.example.smartbudget.data.CardTransactionParser
import com.example.smartbudget.data.SettingsRepository
import com.example.smartbudget.data.WebhookSender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 카드사 푸시 알림을 감지하는 NotificationListenerService.
 * 
 * 이 서비스는 시스템에 의해 자동으로 관리되며,
 * 사용자가 "알림 접근 권한"을 허용하면 활성화됩니다.
 * 
 * 동작 흐름:
 * 1. 카드사 앱에서 결제 알림이 수신됨
 * 2. onNotificationPosted()가 호출됨
 * 3. 알림 텍스트에서 금액, 가맹점명 등을 파싱
 * 4. Apps Script 웹훅으로 데이터 전송
 */
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class CardNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "CardNotifListener"
        
        // 감지할 카드사 앱 패키지명 목록
        val CARD_APP_PACKAGES = setOf(
            "com.shinhansec.mts",              // 신한카드
            "com.shinhan.smartcaremgr",        // 신한카드 (스마트케어)
            "com.shinhancard.smartshinhan",    // 신한 SOL페이
            "com.shinhan.sbanking",            // 신한 SOL뱅크
            "com.shinhan.smail",               // 신한 간편알림
            "nh.smart.nhallonepay",            // NH농협카드
            "nh.smart.card",                   // NH농협카드 (구버전)
            "com.hyundaicard.appcard",         // 현대카드
            "com.hanaskcard.paycla",           // 하나카드
            "com.hana.ez",                     // 하나은행
            "com.kftc.iche.app",               // 지역화폐 (공통)
            "kr.co.iconloop.zzeung",           // 인천이음카드
            "gov.gyeonggi.pay",                // 경기지역화폐 (부천페이 등)
            "com.konai.app",                   // 코나카드
            "com.kbstar.liivbank",             // KB국민
            "com.kbcard.cxh.appcard"           // KB Pay
        )
        
        // 결제 관련 키워드 (알림 텍스트에 이 중 하나라도 포함되어야 함)
        val PAYMENT_KEYWORDS = listOf("승인", "결제", "사용", "출금", "이용")
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "ACTION_RECHECK_NOTIFICATIONS") {
            try {
                Log.d(TAG, "떠있는 알림 재검사 요청 수신")
                val activeNotifications = activeNotifications
                if (activeNotifications != null) {
                    for (sbn in activeNotifications) {
                        onNotificationPosted(sbn)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "재검사 실패", e)
            }
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        val packageName = sbn.packageName
        
        // 카드사 앱의 알림인지 확인
        if (packageName !in CARD_APP_PACKAGES) return

        // 알림 텍스트 추출
        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""
        
        // 여러 줄 알림(InboxStyle 등)인 경우
        val textLines = extras.getCharSequenceArray("android.textLines")?.joinToString(" ") ?: ""
        
        val fullText = "$title $text $bigText $textLines"
        
        // 결제 관련 알림인지 확인
        if (PAYMENT_KEYWORDS.none { fullText.contains(it) }) return
        
        Log.d(TAG, "카드 결제 알림 감지: [$packageName] $fullText")

        // 알림 텍스트 파싱
        val transaction = CardTransactionParser.parse(fullText, packageName)
        
        if (transaction != null) {
            Log.i(TAG, "파싱 성공: ${transaction.card} ${transaction.amount}원 ${transaction.merchant}")
            
            // Apps Script 웹훅으로 전송
            serviceScope.launch {
                val webhookUrl = SettingsRepository.getWebhookUrl(applicationContext)
                if (webhookUrl.isNotBlank()) {
                    val success = WebhookSender.send(webhookUrl, transaction)
                    if (success) {
                        showSuccessNotification(transaction)
                    }
                } else {
                    Log.w(TAG, "웹훅 URL이 설정되지 않았습니다.")
                }
            }
        } else {
            Log.w(TAG, "파싱 실패: $fullText")
        }
    }

    private fun showSuccessNotification(tx: CardTransactionParser.Transaction) {
        try {
            val builder = NotificationCompat.Builder(this, "SMART_BUDGET_CHANNEL")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("가계부 자동 기록 완료 📝")
                .setContentText("${tx.merchant}에서 ${tx.amount}원 결제 내역이 시트에 저장되었습니다.")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)

            with(NotificationManagerCompat.from(this)) {
                // 권한 체크는 NotificationListenerService 이므로 무시하거나, 
                // Target API 33 이상이면 POST_NOTIFICATIONS 필요하지만 앱 수준에서 처리했다고 가정
                notify(System.currentTimeMillis().toInt(), builder.build())
            }
        } catch (e: Exception) {
            Log.e(TAG, "알림 띄우기 실패", e)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // 알림 제거 시에는 특별한 작업 불필요
    }
}
