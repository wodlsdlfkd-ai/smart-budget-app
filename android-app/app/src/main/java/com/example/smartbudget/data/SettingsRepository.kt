package com.example.smartbudget.data

import android.content.Context
import android.content.SharedPreferences

/**
 * 앱 설정을 SharedPreferences에 저장/로드하는 저장소.
 */
object SettingsRepository {

    private const val PREFS_NAME = "smart_budget_prefs"
    private const val KEY_WEBHOOK_URL = "webhook_url"
    private const val KEY_SERVICE_ENABLED = "service_enabled"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /** Apps Script 웹훅 URL 저장 */
    fun setWebhookUrl(context: Context, url: String) {
        getPrefs(context).edit().putString(KEY_WEBHOOK_URL, url).apply()
    }

    /** Apps Script 웹훅 URL 로드 */
    fun getWebhookUrl(context: Context): String {
        return getPrefs(context).getString(KEY_WEBHOOK_URL, "") ?: ""
    }

    /** 서비스 활성화 상태 저장 */
    fun setServiceEnabled(context: Context, enabled: Boolean) {
        getPrefs(context).edit().putBoolean(KEY_SERVICE_ENABLED, enabled).apply()
    }

    /** 서비스 활성화 상태 로드 */
    fun isServiceEnabled(context: Context): Boolean {
        return getPrefs(context).getBoolean(KEY_SERVICE_ENABLED, true)
    }
}
