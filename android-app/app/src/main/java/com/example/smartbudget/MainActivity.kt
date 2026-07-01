package com.example.smartbudget

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.smartbudget.data.CardTransactionParser
import com.example.smartbudget.data.SettingsRepository
import com.example.smartbudget.data.WebhookSender
import kotlinx.coroutines.launch
import com.example.smartbudget.service.CardNotificationListener
import com.example.smartbudget.theme.SmartBudgetTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        
        createNotificationChannel()
        
        setContent {
            SmartBudgetTheme {
                SmartBudgetApp()
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "스마트 가계부 알림"
            val descriptionText = "카드 결제 기록 성공 시 알림을 표시합니다"
            val importance = NotificationManager.IMPORTANCE_DEFAULT
            val channel = NotificationChannel("SMART_BUDGET_CHANNEL", name, importance).apply {
                description = descriptionText
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SmartBudgetApp() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var webhookUrl by remember { mutableStateOf(SettingsRepository.getWebhookUrl(context)) }
    var isListenerEnabled by remember { mutableStateOf(isNotificationListenerEnabled(context)) }
    var showSavedMessage by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()

    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {}

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    // 포커스가 돌아올 때(화면이 다시 켜질 때) 권한 상태 재확인
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isListenerEnabled = isNotificationListenerEnabled(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "💰 스마트 가계부",
                        fontWeight = FontWeight.Bold
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // === 상태 카드 ===
            StatusCard(isListenerEnabled)

            // === 알림 권한 설정 ===
            SectionCard(
                title = "🔔 알림 접근 권한",
                description = if (isListenerEnabled) 
                    "알림 접근 권한이 허용되었습니다. 카드 결제 알림을 감지할 수 있습니다."
                else 
                    "카드 결제 알림을 자동으로 감지하려면 알림 접근 권한을 허용해야 합니다."
            ) {
                Button(
                    onClick = {
                        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                        context.startActivity(intent)
                    },
                    colors = if (isListenerEnabled)
                        ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981))
                    else
                        ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        if (isListenerEnabled) "✅ 권한 허용됨 (설정 열기)" else "권한 설정하러 가기",
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }
            }

            // === 웹훅 URL 설정 ===
            SectionCard(
                title = "🔗 Apps Script 웹훅 URL",
                description = "Google Apps Script 배포 URL을 입력하세요. 감지된 결제 내역이 이 URL로 전송되어 스프레드시트에 자동 기록됩니다."
            ) {
                OutlinedTextField(
                    value = webhookUrl,
                    onValueChange = { webhookUrl = it },
                    label = { Text("웹훅 URL") },
                    placeholder = { Text("https://script.google.com/macros/s/...") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                Spacer(modifier = Modifier.height(8.dp))

                Button(
                    onClick = {
                        SettingsRepository.setWebhookUrl(context, webhookUrl)
                        showSavedMessage = true
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        "URL 저장",
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedButton(
                    onClick = {
                        val url = SettingsRepository.getWebhookUrl(context)
                        if (url.isBlank()) {
                            testResult = "URL을 먼저 저장해주세요"
                            return@OutlinedButton
                        }
                        testResult = "전송 중..."
                        coroutineScope.launch {
                            val dummyTx = CardTransactionParser.Transaction(
                                date = "2026-06-29",
                                time = "12:00",
                                amount = 9900,
                                merchant = "웹훅연동테스트",
                                card = "신한카드"
                            )
                            val success = WebhookSender.send(url, dummyTx)
                            testResult = if (success) "✅ 테스트 전송 성공! 시트를 확인하세요" else "❌ 전송 실패 (URL 확인 요망)"
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        "테스트 알림 전송",
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedButton(
                    onClick = {
                        val url = SettingsRepository.getWebhookUrl(context)
                        if (url.isBlank()) {
                            testResult = "URL을 먼저 저장해주세요"
                            return@OutlinedButton
                        }
                        
                        val intent = android.content.Intent(context, CardNotificationListener::class.java).apply {
                            action = "ACTION_RECHECK_NOTIFICATIONS"
                        }
                        context.startService(intent)
                        
                        testResult = "재수집 요청 완료! 5초 뒤 시트를 확인해보세요."
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        "현재 떠있는 카드 알림 싹 다 수집하기",
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }

                if (showSavedMessage) {
                    LaunchedEffect(showSavedMessage) {
                        kotlinx.coroutines.delay(2000)
                        showSavedMessage = false
                    }
                    Text(
                        "✅ 저장되었습니다!",
                        color = Color(0xFF10B981),
                        fontSize = 14.sp,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                
                if (testResult != null) {
                    Text(
                        text = testResult!!,
                        color = if (testResult!!.startsWith("✅")) Color(0xFF10B981) else Color(0xFFEF4444),
                        fontSize = 14.sp,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }

            // === 사용 방법 ===
            SectionCard(
                title = "📖 사용 방법",
                description = null
            ) {
                val steps = listOf(
                    "1. 위의 '알림 접근 권한'을 허용합니다",
                    "2. Apps Script 웹훅 URL을 입력하고 저장합니다",
                    "3. 이 앱을 닫아도 됩니다 (백그라운드 실행)",
                    "4. 카드를 사용하면 자동으로 스프레드시트에 기록!",
                    "5. 웹 대시보드에서 지출 현황을 확인하세요"
                )
                steps.forEach { step ->
                    Text(
                        text = step,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }

            // === 지원 카드사 ===
            SectionCard(
                title = "💳 지원 카드사",
                description = null
            ) {
                val cards = listOf(
                    "신한카드", "NH농협카드", "현대카드", 
                    "하나카드", "인천이음카드", "부천페이"
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    cards.take(3).forEach { card ->
                        CardChip(card, Modifier.weight(1f))
                    }
                }
                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    cards.drop(3).forEach { card ->
                        CardChip(card, Modifier.weight(1f))
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
fun StatusCard(isEnabled: Boolean) {
    val gradient = if (isEnabled) {
        Brush.linearGradient(listOf(Color(0xFF10B981), Color(0xFF14B8A6)))
    } else {
        Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFEF4444)))
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(gradient)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = if (isEnabled) "🟢 수집 중" else "🔴 비활성",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = if (isEnabled) 
                    "카드 결제 알림을 감지하고 있습니다" 
                else 
                    "알림 권한을 허용해주세요",
                fontSize = 14.sp,
                color = Color.White.copy(alpha = 0.9f),
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
fun SectionCard(
    title: String,
    description: String?,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = title,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (description != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = description,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    lineHeight = 18.sp
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
fun CardChip(name: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f)
    ) {
        Text(
            text = name,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp),
            color = MaterialTheme.colorScheme.onPrimaryContainer
        )
    }
}

/**
 * NotificationListenerService가 활성화되어 있는지 확인합니다.
 */
fun isNotificationListenerEnabled(context: android.content.Context): Boolean {
    val cn = ComponentName(context, CardNotificationListener::class.java)
    val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
    return flat != null && flat.contains(cn.flattenToString())
}
