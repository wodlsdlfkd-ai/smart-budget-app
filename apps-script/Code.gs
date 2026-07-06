/* ============================================
   스마트 가계부 - Google Apps Script 백엔드
   ============================================
   
   이 스크립트를 구글 스프레드시트의 Apps Script 에디터에 붙여넣으세요.
   (스프레드시트 상단 메뉴 → 확장 프로그램 → Apps Script)
   
   기능:
   1. doPost() - 안드로이드 앱에서 결제 알림 데이터를 수신하여 시트에 기록
   2. doGet()  - 웹 대시보드에서 데이터를 조회하는 API
   3. Gemini AI를 이용한 카테고리 자동 분류
   4. 월별 시트 자동 생성 ("빈양식" 탭 복사)
   
   ============================================ */

// ==========================================
// 설정 (사용자가 수정해야 하는 부분)
// ==========================================

/** Gemini API 키 (https://aistudio.google.com/apikey 에서 발급) */
const GEMINI_API_KEY = 'AIzaSyBWGfaAD__xRq56dMt4ATCl_sR-PRS0ijk';

/** "빈양식" 시트 탭 이름 (기존 스프레드시트의 템플릿 탭 이름과 동일해야 함) */
const TEMPLATE_SHEET_NAME = '빈양식';

/** 텔레그램 연동 설정 (챗봇 프로젝트에서 가져옴) */
const TELEGRAM_BOT_TOKEN = '8920086102:AAFv6jLpC6doqaQ5AgKf0P3PeTy3ZEFB1e0';
const TELEGRAM_CHANNEL_ID = '-1003943179340';

/** 카테고리 목록 (Gemini AI가 이 목록 중에서만 선택합니다) */
const CATEGORIES = ['밥', '육아', '카페', '쇼핑', '여가', '마트', '헌금', '병원', '선물', '기타', '수입', '공과금'];

/** 데이터가 기입되는 컬럼 위치 (1-indexed) */
const COLUMNS = {
  DATE: 10,      // J열: 날짜
  AMOUNT: 11,    // K열: 지출금액
  CATEGORY: 12,  // L열: 분류
  MERCHANT: 13,  // M열: 내역
  // N열은 통장잔액 (수식이 들어있으므로 건드리지 않음)
  CARD: 15       // O열: 카드사
};

/** 데이터 입력이 시작되는 행 (헤더 제외) */
const DATA_START_ROW = 28;


// ==========================================
// 1. 웹훅 엔드포인트 - POST (알림 수신)
// ==========================================

/**
 * 안드로이드 앱에서 결제 알림 데이터를 POST로 수신합니다.
 * 
 * 요청 형식 (JSON):
 * {
 *   "date": "2026-06-28",
 *   "time": "14:30",
 *   "amount": 12000,
 *   "merchant": "스타벅스강남점",
 *   "card": "신한카드"
 * }
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // 수동 수정/삭제 분기
    if (data.action === 'edit') {
      return handleEditTransaction(data);
    }
    if (data.action === 'delete') {
      return handleDeleteTransaction(data);
    }
    
    // 필수 필드 검증
    if (!data.date || typeof data.amount === 'undefined' || !data.merchant || !data.card) {
      return createJsonResponse({ 
        success: false, 
        error: '필수 필드 누락 (date, amount, merchant, card)' 
      });
    }

    // 1) 환불/취소 검사 (amount < 0) 또는 Gemini AI로 카테고리 자동 분류
    let category = '기타';
    if (data.amount < 0) {
      category = '수입';
    } else {
      category = classifyCategory(data.merchant);
    }

    // 2) 해당 월의 시트 가져오기 (없으면 자동 생성)
    const sheet = getOrCreateMonthlySheet(data.date);

    // 3) 시트에 데이터 기입
    const newRow = findNextEmptyRow(sheet);
    sheet.getRange(newRow, COLUMNS.DATE).setValue(data.date);
    sheet.getRange(newRow, COLUMNS.AMOUNT).setValue(data.amount);
    sheet.getRange(newRow, COLUMNS.CATEGORY).setValue(category);
    sheet.getRange(newRow, COLUMNS.MERCHANT).setValue(data.merchant + (data.time ? ` (${data.time})` : ''));
    sheet.getRange(newRow, COLUMNS.CARD).setValue(data.card);
    
    // 4) 텔레그램 예산 알림 확인 (N27 시트 기준)
    checkBudgetAlert(sheet);

    // 5) 성공 응답
    return createJsonResponse({
      success: true,
      message: '기록 완료',
      data: {
        date: data.date,
        amount: data.amount,
        category: category,
        merchant: data.merchant,
        card: data.card,
        sheet: sheet.getName(),
        row: newRow
      }
    });

  } catch (error) {
    return createJsonResponse({ 
      success: false, 
      error: error.toString() 
    });
  }
}

/**
 * 대시보드에서 보낸 결제 내역 수정(POST)을 처리합니다.
 */
function handleEditTransaction(data) {
  if (!data.id || !data.date || typeof data.amount === 'undefined' || !data.category || !data.merchant || !data.card) {
    return createJsonResponse({ success: false, error: '필수 수정 필드 누락' });
  }

  const row = parseInt(data.id.replace('r', ''), 10);
  if (isNaN(row)) {
    return createJsonResponse({ success: false, error: '잘못된 ID 형식' });
  }

  // 날짜 기반으로 대상 시트 찾기 (YYYY-MM-DD -> YYYY.MM)
  const dateParts = data.date.split('-');
  const sheetName = `${dateParts[0]}.${dateParts[1]}`;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return createJsonResponse({ success: false, error: '해당 월의 시트를 찾을 수 없습니다.' });
  }

  sheet.getRange(row, COLUMNS.DATE).setValue(data.date);
  sheet.getRange(row, COLUMNS.AMOUNT).setValue(data.amount);
  sheet.getRange(row, COLUMNS.CATEGORY).setValue(data.category);
  sheet.getRange(row, COLUMNS.MERCHANT).setValue(data.merchant);
  sheet.getRange(row, COLUMNS.CARD).setValue(data.card);

  return createJsonResponse({ success: true, message: '수정 완료' });
}

/**
 * 대시보드에서 보낸 결제 내역 삭제(POST)를 처리합니다.
 * 안전을 위해 행을 지우지 않고 내용만 빈칸으로 만듭니다.
 */
function handleDeleteTransaction(data) {
  if (!data.id || !data.date) {
    return createJsonResponse({ success: false, error: '필수 삭제 필드 누락' });
  }

  const row = parseInt(data.id.replace('r', ''), 10);
  if (isNaN(row)) {
    return createJsonResponse({ success: false, error: '잘못된 ID 형식' });
  }

  const dateParts = data.date.split('-');
  const sheetName = `${dateParts[0]}.${dateParts[1]}`;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return createJsonResponse({ success: false, error: '해당 월의 시트를 찾을 수 없습니다.' });
  }

  sheet.getRange(row, COLUMNS.DATE).clearContent();
  sheet.getRange(row, COLUMNS.AMOUNT).clearContent();
  sheet.getRange(row, COLUMNS.CATEGORY).clearContent();
  sheet.getRange(row, COLUMNS.MERCHANT).clearContent();
  sheet.getRange(row, COLUMNS.CARD).clearContent();

  return createJsonResponse({ success: true, message: '삭제 완료' });
}


// ==========================================
// 2. 데이터 API - GET (대시보드 조회)
// ==========================================

/**
 * 웹 대시보드에서 데이터를 조회합니다.
 * 
 * 사용법:
 *   ?action=transactions&year=2026&month=6  → 해당 월의 모든 거래 내역
 *   ?action=summary&year=2026&month=6      → 해당 월의 카드별/카테고리별 요약
 *   ?action=cards                          → 등록된 카드 목록 (설정 시트에서)
 */
function doGet(e) {
  try {
    const action = e.parameter.action || 'summary';
    const year = parseInt(e.parameter.year) || new Date().getFullYear();
    const month = parseInt(e.parameter.month) || (new Date().getMonth() + 1);
    
    let result;
    
    switch (action) {
      case 'transactions':
        result = getTransactions(year, month);
        break;
      case 'summary':
        result = getSummary(year, month);
        break;
      case 'cards':
        result = getCardSettings();
        break;
      default:
        result = { error: '알 수 없는 action: ' + action };
    }

    return createJsonResponse({ success: true, data: result });

  } catch (error) {
    return createJsonResponse({ 
      success: false, 
      error: error.toString() 
    });
  }
}

/**
 * 해당 월의 모든 거래 내역을 반환합니다.
 */
function getTransactions(year, month) {
  const sheetName = `${year}.${String(month).padStart(2, '0')}`;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { transactions: [], total: 0, count: 0 };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) {
    return { transactions: [], total: 0, count: 0 };
  }

  const transactions = [];
  let total = 0;

  for (let row = DATA_START_ROW; row <= lastRow; row++) {
    const date = sheet.getRange(row, COLUMNS.DATE).getValue();
    const amount = sheet.getRange(row, COLUMNS.AMOUNT).getValue();
    const category = sheet.getRange(row, COLUMNS.CATEGORY).getValue();
    const merchant = sheet.getRange(row, COLUMNS.MERCHANT).getValue();
    const card = sheet.getRange(row, COLUMNS.CARD).getValue();

    if (!date && !amount) continue; // 빈 행 스킵

    // 날짜 포맷 처리
    let dateStr = '';
    if (date instanceof Date) {
      dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      // 2026.06.01 같은 형식을 2026-06-01로 변환
      dateStr = String(date).replace(/\./g, '-');
    }

    // 내역에서 시간 추출 (있는 경우)
    let time = '';
    const timeMatch = String(merchant).match(/\((\d{1,2}:\d{2})\)/);
    if (timeMatch) {
      time = timeMatch[1];
    }

    const numericAmount = Number(amount) || 0;
    if (numericAmount > 0) total += numericAmount; // 순지출만 합산 (취소 건 제외)

    transactions.push({
      id: `r${row}`,
      date: dateStr,
      time: time,
      amount: numericAmount,
      category: String(category),
      merchant: String(merchant).replace(/\s*\(\d{1,2}:\d{2}\)/, ''), // 시간 제거
      card: String(card)
    });
  }

  return {
    transactions: transactions,
    total: total,
    count: transactions.length
  };
}

/**
 * 해당 월의 카드별/카테고리별 요약을 반환합니다.
 */
function getSummary(year, month) {
  const txnData = getTransactions(year, month);
  const transactions = txnData.transactions;

  // 카드별 집계
  const cardSummary = {};
  transactions.forEach(function(t) {
    if (!cardSummary[t.card]) {
      cardSummary[t.card] = { total: 0, count: 0 };
    }
    cardSummary[t.card].total += t.amount;
    cardSummary[t.card].count += 1;
  });

  // 카테고리별 집계
  const categorySummary = {};
  CATEGORIES.forEach(function(cat) {
    categorySummary[cat] = 0;
  });
  transactions.forEach(function(t) {
    if (categorySummary[t.category] !== undefined) {
      categorySummary[t.category] += t.amount;
    } else {
      categorySummary['기타'] = (categorySummary['기타'] || 0) + t.amount;
    }
  });

  // 일별 집계
  const dailySummary = {};
  transactions.forEach(function(t) {
    const day = t.date.split('-')[2];
    if (!dailySummary[day]) {
      dailySummary[day] = 0;
    }
    dailySummary[day] += t.amount;
  });

  return {
    total: txnData.total,
    count: txnData.count,
    byCard: cardSummary,
    byCategory: categorySummary,
    byDay: dailySummary
  };
}


// ==========================================
// 3. 월별 시트 자동 생성
// ==========================================

/**
 * 날짜 문자열에서 해당 월의 시트를 가져옵니다.
 * 시트가 없으면 "빈양식" 탭을 복사하여 자동 생성합니다.
 * 
 * @param {string} dateStr - "2026-06-28" 형식의 날짜
 * @returns {Sheet} 해당 월의 시트
 */
function getOrCreateMonthlySheet(dateStr) {
  const parts = dateStr.split('-');
  const year = parts[0];
  const month = parts[1]; // 이미 zero-padded
  const sheetName = `${year}.${month}`;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  
  if (sheet) {
    return sheet;
  }

  // "빈양식" 탭에서 복사
  const template = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (!template) {
    throw new Error(`"${TEMPLATE_SHEET_NAME}" 시트를 찾을 수 없습니다. 템플릿 시트가 존재하는지 확인하세요.`);
  }

  sheet = template.copyTo(ss);
  sheet.setName(sheetName);
  
  // 시트 탭을 기존 월별 시트들과 함께 정렬 (빈양식 다음에 배치)
  const templateIndex = template.getIndex();
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(templateIndex + 1);

  Logger.log(`새 월별 시트 생성: ${sheetName}`);
  
  return sheet;
}

/**
 * 시트에서 다음 빈 행을 찾습니다.
 */
function findNextEmptyRow(sheet) {
  const lastRow = sheet.getLastRow();
  // DATA_START_ROW부터 시작하여 빈 행 찾기
  if (lastRow < DATA_START_ROW) {
    return DATA_START_ROW;
  }
  
  // 날짜 열(A열)에서 비어있는 첫 번째 행 찾기
  const dateCol = sheet.getRange(DATA_START_ROW, COLUMNS.DATE, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < dateCol.length; i++) {
    if (!dateCol[i][0] || dateCol[i][0] === '') {
      return DATA_START_ROW + i;
    }
  }
  
  return lastRow + 1;
}


// ==========================================
// 4. Gemini AI 카테고리 분류
// ==========================================

/**
 * Gemini AI를 사용하여 가맹점명을 카테고리로 분류합니다.
 * 
 * @param {string} merchant - 가맹점명 (예: "스타벅스강남점")
 * @returns {string} 분류된 카테고리 (예: "카페")
 */
function classifyCategory(merchant) {
  const m = String(merchant);

  // ── 1차: 키워드 기반 즉시 분류 ──────────────────────────
  const KEYWORD_MAP = {
    '밥':    ['식당','음식점','한식','중식','일식','양식','치킵','피자','버거','맥도날드','롯데리아','KFC','버거킵',
              '맘스터치','스시','라면','분식','국밥','갈비','삼격살','설렇탕','해장국','김밥','순대','호프',
              '배달의민족','요기요','쿠팡이츠','포차','고기','식육','반찬','도시락','백반','냉면','칼국수',
              '찌개','회집','초밥','샴브','휘교','양꽃로치','곱창','족발','보쥐','새우','해산물','생선',
              '소문난','난양','해장','경양식','정식','먹자','먹거리'],
    '카페': ['스타벅스','카페','베이커리','빵','투쎌','콤포즈','메가커피','커피','디저트','케이크','마카롱',
              '브런치','파리바게트','띄레주르','던킨','배스킨','아이스크림','할리스','폴바셋','앤제리너스',
              '이디야','탐앤탑스','공차','주스','음료','버블티'],
    '쇼핑': ['쿠팡','11번가','네이버페이','G마켓','옥션','SSG','ssg','올리브영','다이소','유니클로','자라',
              '무신사','에이블리','지그재그','아이디어스','오늘의집','인터파크','위메프','티몳',
              '롤데백화점','현대백화점','신세계','갤러리아','AK플라자','이케아','편의점','CU','GS25',
              '세븐일레븐','미니스톱','이마트24','나이키','아디다스','뉴발란스','ABC마트','효성에프엠에스'],
    '마트': ['이마트','홈플러스','롯데마트','코스트코','하나로마트','농협마트','메가마트','킴스클럽',
              '노브랜드','트레이더스'],
    '여가': ['CGV','롯데시네마','메가박스','cgv','씨지브이','헬스장','피트니스','볼링','노래방','노래연습',
              'PC방','게임','레저','수영','골프','테니스','당구','스크린','스크린골프','짔질방','사우나','스파','마사지',
              '여행','관광','숙박','호텔','모텔','펙션','에어비앤비'],
    '병원': ['의원','병원','약국','치과','한의원','안과','이비인후과','피부과','성형','산부인과',
              '소아과','정형외과','내과','외과','신경과','정신건강','클리닉','메디컴','헬스케어','의료'],
    '공과금':['전기','수도','가스비','도시가스','통신비','인터넷','SKT','KT','LG유플러스','관리비',
              '아파트','세금','국민연금','건강보험','고지서'],
    '육아':  ['유치원','어린이집','학원','학습지','교육','학용품','장난감','유아','어린이','키즈',
              '아기','분유','기저귀'],
    '헌금':  ['교회','성당','절','헌금','십일조','봉헌'],
    '선물':  ['꽃집','플라워','선물','기프티콘','상품권','기프트']
  };

  const lowerM = m.toLowerCase();
  for (const category in KEYWORD_MAP) {
    const keywords = KEYWORD_MAP[category];
    for (let i = 0; i < keywords.length; i++) {
      if (lowerM.indexOf(keywords[i].toLowerCase()) !== -1) {
        Logger.log('[키워드 분류] "' + m + '" -> "' + category + '" (키워드: ' + keywords[i] + ')');
        return category;
      }
    }
  }

  // ── 2차: Gemini AI 분류 (키워드 미매칭 시) ──────────────
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    Logger.log('[Gemini 없음] "' + m + '" -> "기타"');
    return '기타';
  }

  try {
    const prompt = '다음 결제 가맹점명을 보고, 아래 카테고리 목록 중 가장 적절한 카테고리 하나만 답하세요. 카테고리명만 답하고 다른 설명은 하지 마세요.\n\n카테고리 목록: ' + CATEGORIES.join(', ') + '\n\n가맹점명: ' + m + '\n\n답변:';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
    };
    const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };

    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const answer = json.candidates[0].content.parts[0].text.trim();
      const matched = CATEGORIES.find(function(cat) { return answer.indexOf(cat) !== -1; });
      if (matched) {
        Logger.log('[Gemini 분류] "' + m + '" -> "' + matched + '"');
        return matched;
      }
      Logger.log('[Gemini 매칭 실패] 응답: "' + answer + '" -> "기타"');
    } else {
      Logger.log('[Gemini API 오류] 응답: ' + responseText.substring(0, 200));
    }
    return '기타';
  } catch (error) {
    Logger.log('[Gemini 예외] ' + error.toString());
    return '기타';
  }
}


// ==========================================
// 5. 카드 설정 관리
// ==========================================

/** 
 * 카드 설정을 "설정" 시트에서 읽어옵니다.
 * "설정" 시트가 없으면 기본 카드 목록을 반환합니다.
 */
function getCardSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName('설정');
  
  if (!settingsSheet) {
    // 기본 카드 목록 반환
    return {
      cards: [
        { name: '신한카드', type: 'credit', limit: 0 },
        { name: 'NH농협카드', type: 'credit', limit: 340000 },
        { name: '현대카드', type: 'credit', limit: 300000 },
        { name: '하나카드', type: 'credit', limit: 300000 },
        { name: '인천이음카드', type: 'local', limit: 0 },
        { name: '부천페이', type: 'local', limit: 0 }
      ]
    };
  }

  // "설정" 시트에서 카드 정보 읽기
  // 형식: A열=카드명, B열=유형(credit/local), C열=월실적기준
  const lastRow = settingsSheet.getLastRow();
  const cards = [];
  
  for (let row = 2; row <= lastRow; row++) {
    const name = settingsSheet.getRange(row, 1).getValue();
    if (!name) continue;
    
    cards.push({
      name: String(name),
      type: String(settingsSheet.getRange(row, 2).getValue() || 'credit'),
      limit: Number(settingsSheet.getRange(row, 3).getValue()) || 0
    });
  }

  return { cards: cards };
}


// ==========================================
// 6. 유틸리티 함수
// ==========================================

/**
 * JSON 응답을 생성합니다. CORS 허용.
 */
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ==========================================
// 7. 텔레그램 알림 발송 함수
// ==========================================

/**
 * 텔레그램으로 메시지를 발송합니다.
 */
function sendToTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === '') return;
  
  const textUrl = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  const payload = { 
    "chat_id": TELEGRAM_CHANNEL_ID.toString(), 
    "text": text, 
    "parse_mode": "HTML" 
  };
  
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  try {
    UrlFetchApp.fetch(textUrl, options);
  } catch(e) {
    Logger.log("Telegram 발송 에러: " + e.message);
  }
}

/**
 * 시트의 이번 달 총 지출을 N27 셀의 예산과 비교하여 알림을 보냅니다.
 * 구간: 50%, 70%, 90%, 100%
 */
function checkBudgetAlert(sheet) {
  const budget = Number(sheet.getRange('N27').getValue());
  if (!budget || budget <= 0) return; // N27 셀에 예산이 없으면 무시

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return;

  let totalSpent = 0;
  const amounts = sheet.getRange(DATA_START_ROW, COLUMNS.AMOUNT, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < amounts.length; i++) {
    const amount = Number(amounts[i][0]) || 0;
    if (amount > 0) totalSpent += amount; // 수입(마이너스) 제외 여부는 선택사항
  }

  const percent = Math.floor((totalSpent / budget) * 100);
  const milestones = [100, 90, 70, 50];
  let hitMilestone = null;

  for (let i = 0; i < milestones.length; i++) {
    if (percent >= milestones[i]) {
      hitMilestone = milestones[i];
      break;
    }
  }

  if (hitMilestone) {
    const props = PropertiesService.getScriptProperties();
    const monthKey = "budget_alert_" + sheet.getName();
    const lastAlerted = Number(props.getProperty(monthKey)) || 0;

    if (hitMilestone > lastAlerted) {
      let msg = "⚠️ <b>[가계부 예산 경고]</b>\n\n";
      if (hitMilestone === 100) {
        msg += "이번 달 총 지출이 설정하신 예산을 <b>초과(100%)</b>했습니다!\n\n";
      } else {
        msg += "이번 달 총 지출이 예산의 <b>" + hitMilestone + "%</b>에 도달했습니다!\n\n";
      }
      msg += "현재 총 지출: " + totalSpent.toLocaleString() + "원\n";
      msg += "이번 달 예산: " + budget.toLocaleString() + "원 (" + percent + "% 사용)\n";
      msg += "남은 예산: " + Math.max(0, budget - totalSpent).toLocaleString() + "원";
      
      sendToTelegram(msg);
      props.setProperty(monthKey, hitMilestone.toString()); // 알림 발송 기록
    }
  }
}

/**
 * 매일 저녁 9시에 실행되어 오늘의 지출 내역을 텔레그램으로 보냅니다.
 */
function sendDailyReport() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const sheetName = year + "." + String(month).padStart(2, '0');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) return;
  
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const lastRow = sheet.getLastRow();
  
  if (lastRow < DATA_START_ROW) return;
  
  let todaySpent = 0;
  let todayCount = 0;
  let todayTransactions = [];
  let totalSpent = 0;
  
  // 10열(DATE)부터 15열(CARD)까지 가져오기 (총 6열)
  const data = sheet.getRange(DATA_START_ROW, COLUMNS.DATE, lastRow - DATA_START_ROW + 1, 6).getValues();
  
  for (let i = 0; i < data.length; i++) {
    const rowDate = data[i][0];
    if (!rowDate) continue;
    
    let rDateStr = "";
    if (rowDate instanceof Date) {
      rDateStr = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      rDateStr = String(rowDate).replace(/\./g, '-');
    }
    
    const amount = Number(data[i][1]) || 0;
    if (amount > 0) totalSpent += amount;
    
    if (rDateStr === dateStr) {
      todaySpent += amount;
      todayCount++;
      const merchant = String(data[i][3]).replace(/\s*\(\d{1,2}:\d{2}\)/, ''); // 시간 제거
      todayTransactions.push("• " + merchant + " : " + amount.toLocaleString() + "원");
    }
  }
  
  const budget = Number(sheet.getRange('N27').getValue());
  
  let msg = "💳 <b>[오늘의 지출 요약 리포트]</b>\n\n";
  msg += "오늘 총 " + todayCount + "건, <b>" + todaySpent.toLocaleString() + "원</b> 사용\n\n";
  
  if (todayCount > 0) {
    msg += todayTransactions.join("\n") + "\n\n";
  } else {
    msg += "오늘은 지출이 없습니다! 절약왕 👑\n\n";
  }
  
  if (budget > 0) {
    const percent = Math.floor((totalSpent / budget) * 100);
    msg += "이번 달 누적: " + totalSpent.toLocaleString() + "원 / 예산 " + budget.toLocaleString() + "원 (" + percent + "%)";
  } else {
    msg += "이번 달 누적: " + totalSpent.toLocaleString() + "원";
  }
  
  sendToTelegram(msg);
}

/**
 * 일일 리포트 알림을 위한 시간 트리거를 설정합니다. (최초 1회 수동 실행)
 */
function setupDailyReportTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyReport') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // 매일 밤 9시(21:00) 즈음에 실행
  ScriptApp.newTrigger('sendDailyReport')
           .timeBased()
           .atHour(21)
           .everyDays(1)
           .create();
           
  Logger.log("일일 리포트 시간 트리거(매일 21시)가 설정되었습니다.");
}

// ==========================================
// 8. 테스트 함수 (개발용)
// ==========================================

/**
 * 수동으로 테스트할 때 사용하는 함수입니다.
 * Apps Script 에디터에서 직접 실행하여 동작을 확인하세요.
 */
function testAddTransaction() {
  const mockData = {
    postData: {
      contents: JSON.stringify({
        date: '2026-06-28',
        time: '14:30',
        amount: 4500,
        merchant: '스타벅스 강남점',
        card: '신한카드'
      })
    }
  };

  const result = doPost(mockData);
  Logger.log(result.getContent());
}

/**
 * Gemini AI 카테고리 분류 테스트
 */
function testClassify() {
  const testCases = [
    '스타벅스 강남점',
    '이마트 부천점',
    'CGV 인천',
    '배달의민족',
    '올리브영',
    '전기세',
    '내과의원'
  ];

  testCases.forEach(function(merchant) {
    const category = classifyCategory(merchant);
    Logger.log(`"${merchant}" → "${category}"`);
  });
}

/**
 * 대시보드 API 테스트
 */
function testGetSummary() {
  const mockEvent = {
    parameter: {
      action: 'summary',
      year: '2026',
      month: '6'
    }
  };

  const result = doGet(mockEvent);
  Logger.log(result.getContent());
}
