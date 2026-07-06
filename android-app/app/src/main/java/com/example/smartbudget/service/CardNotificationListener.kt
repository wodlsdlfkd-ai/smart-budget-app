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
        
        // 중복 방지 캐시
        private val recentTransactions = mutableSetOf<String>()
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
        val title = extras.getCharSequence("android.title")?.toString()?.trim() ?: ""
        val text = extras.getCharSequence("android.text")?.toString()?.trim() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString()?.trim() ?: ""
        
        // 여러 줄 알림(InboxStyle 등)인 경우 줄바꿈으로 연결
        val textLinesArray = extras.getCharSequenceArray("android.textLines")
        val textLines = textLinesArray?.joinToString("\n")?.trim() ?: ""
        
        val fullTextFallback = "$title $text $bigText ${textLinesArray?.joinToString(" ")}"
        
        // 결제 관련 알림인지 대략 확인
        if (PAYMENT_KEYWORDS.none { fullTextFallback.contains(it) } && !fullTextFallback.contains("취소") && !fullTextFallback.contains("환불")) return
        
        Log.d(TAG, "카드 결제 알림 감지: [$packageName] title=$title, text=$text, bigText=$bigText, textLines=$textLines")

        // 알림 텍스트 파싱 (새로운 라우팅 기반 파서 적용)
        val transaction = CardTransactionParser.parseNotification(
            packageName = packageName,
            title = title,
            text = text,
            bigText = bigText,
            textLines = textLines,
            fullTextFallback = fullTextFallback
        )
        
        if (transaction != null) {
            // 중복 알림 방지 (동일 가맹점, 동일 금액, 동일 날짜, 동일 시간)
            val txHash = "${transaction.card}_${transaction.amount}_${transaction.merchant}_${transaction.date}_${transaction.time}"
            if (recentTransactions.contains(txHash)) {
                Log.d(TAG, "중복된 알림 무시 (이미 처리됨): $txHash")
                return
            }
            recentTransactions.add(txHash)
            if (recentTransactions.size > 100) {
                val iterator = recentTransactions.iterator()
                iterator.next()
                iterator.remove()
            }
            
            Log.i(TAG, "파싱 성공: ${transaction.card} ${transaction.amount}원 ${transaction.merchant}")
            
            // Apps Script 웹훅으로 전송
            serviceScope.launch {
                val webhookUrl = SettingsRepository.getWebhookUrl(applicationContext)
                if (webhookUrl.isNotBlank()) {
                    var success = WebhookSender.send(webhookUrl, transaction)
                    
                    // 1회 재시도 로직
                    if (!success) {
                        Log.w(TAG, "웹훅 전송 1차 실패, 3초 후 재시도합니다.")
                        kotlinx.coroutines.delay(3000)
                        success = WebhookSender.send(webhookUrl, transaction)
                    }

                    if (success) {
                        showNotification("가계부 자동 기록 완료 📝", "${transaction.merchant}에서 ${transaction.amount}원 결제 내역이 시트에 저장되었습니다.")
                    } else {
                        showNotification("가계부 기록 실패 ❌", "${transaction.merchant} 결제 내역 전송에 실패했습니다.")
                    }
                } else {
                    Log.w(TAG, "웹훅 URL이 설정되지 않았습니다.")
                    showNotification("가계부 기록 실패 ⚠️", "웹훅 URL이 설정되지 않았습니다. 앱 설정에서 확인해주세요.")
                }
            }
        } else {
            Log.w(TAG, "파싱 실패: $fullTextFallback")
        }
    }

    private fun showNotification(title: String, message: String) {
        try {
            val builder = NotificationCompat.Builder(this, "SMART_BUDGET_CHANNEL")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)

            with(NotificationManagerCompat.from(this)) {
                // API 33 (TIRAMISU) 이상에서는 POST_NOTIFICATIONS 권한 체크
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    if (androidx.core.content.ContextCompat.checkSelfPermission(
                            this@CardNotificationListener,
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                    ) {
                        notify(System.currentTimeMillis().toInt(), builder.build())
                    } else {
                        Log.w(TAG, "POST_NOTIFICATIONS 권한이 없어 알림을 표시할 수 없습니다.")
                    }
                } else {
                    notify(System.currentTimeMillis().toInt(), builder.build())
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "알림 띄우기 실패", e)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // 알림 제거 시에는 특별한 작업 불필요
    }
}
