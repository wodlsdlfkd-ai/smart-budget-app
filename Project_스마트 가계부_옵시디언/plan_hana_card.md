# [하나카드 전용 파서 추가]

하나카드 앱의 결제 알림에서 정확한 가맹점명(예: 쿠팡)과 결제 금액을 추출하기 위한 전용 파서를 구현합니다.

## User Review Required

> [!IMPORTANT]
> - 기존에는 모든 알림을 한 번에 합쳐서 분석했으나, 카드사마다 형식이 달라 오작동이 발생했습니다. 
> - 농협카드에 이어 **하나카드 전용 파서(`HanaCardParser`)**를 추가로 구현하여 정확도를 높입니다.
> - 결제 취소 시 금액을 음수(수입)로 처리하는 로직이 함께 반영됩니다.

## Proposed Changes

### Android App (Parser)
#### [NEW] [HanaCardParser.kt](file:///C:/Users/admin/Desktop/바이브 코딩/스마트 가계부/android-app/app/src/main/java/com/example/smartbudget/data/HanaCardParser.kt)
- **로직 설명**: 
  - 하나카드 알림은 `(결제) 5,650원` 형태의 `title`과 `쿠팡 / 신용(...) / 07.01 11:49 / 누적이용금액...` 형태의 `text`로 수신됩니다.
  - `text`를 슬래시(`/`) 기준으로 분리하여 **첫 번째 항목(쿠팡)**을 가맹점명(merchant)으로 추출합니다.
  - `title`에서 숫자만 추출하여 결제 금액(amount)으로 지정합니다. 만약 `취소`라는 단어가 포함되어 있다면 금액을 음수(-)로 변환합니다.

#### [MODIFY] [CardNotificationListener.kt](file:///C:/Users/admin/Desktop/바이브 코딩/스마트 가계부/android-app/app/src/main/java/com/example/smartbudget/data/CardNotificationListener.kt)
- 알림을 보낸 패키지명 또는 알림 텍스트에 "하나카드" 또는 "하나Pay"가 포함된 경우 `HanaCardParser`를 호출하도록 분기(if-else) 로직을 추가합니다.

## Verification Plan

### Manual Verification
- 해당 코드를 작성한 후 현재 진행 중인 빌드 프로세스에 코드를 즉각 반영하여 새로운 APK 파일로 덮어씌워 빌드하겠습니다.
- 완료되면 스마트폰에 설치 후 하나카드로 결제 시 "쿠팡"이 올바르게 스프레드시트에 기입되는지 확인합니다.
