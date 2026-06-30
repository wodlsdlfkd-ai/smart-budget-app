package com.example.smartbudget.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 기기 부팅 완료 시 알림 수집 서비스가 자동으로 시작되도록 하는 리시버.
 * NotificationListenerService는 시스템에 의해 관리되므로,
 * 여기서는 로그만 남깁니다. (시스템이 자동으로 재시작함)
 */
class BootReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.i(TAG, "기기 부팅 완료 - 스마트 가계부 알림 수집기 대기 중")
            // NotificationListenerService는 시스템이 알림 접근 권한이
            // 허용되어 있으면 자동으로 재시작합니다.
        }
    }
}
