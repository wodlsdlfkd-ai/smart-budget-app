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
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';

/** "빈양식" 시트 탭 이름 (기존 스프레드시트의 템플릿 탭 이름과 동일해야 함) */
const TEMPLATE_SHEET_NAME = '빈양식';

/** 월 초기 통장잔액 (빈양식에 이미 설정되어 있다면 0으로 두세요) */
const DEFAULT_INITIAL_BALANCE = 1250000;

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
    
    // 수동 수정 분기
    if (data.action === 'edit') {
      return handleEditTransaction(data);
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

    // 4) 성공 응답
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
  if (!data.id || !data.date || typeof data.amount === 'undefined' || !data.category || !data.merchant) {
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

  return createJsonResponse({ success: true, message: '수정 완료' });
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
    total += numericAmount;

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
  // API 키가 설정되지 않은 경우 기본값 반환
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    Logger.log('Gemini API 키가 설정되지 않아 "기타"로 분류합니다.');
    return '기타';
  }

  try {
    const prompt = `다음 결제 가맹점명을 보고, 아래 카테고리 목록 중 가장 적절한 카테고리 하나만 답하세요. 카테고리명만 답하고 다른 설명은 하지 마세요.

카테고리 목록: ${CATEGORIES.join(', ')}

가맹점명: ${merchant}

답변:`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 10
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      const answer = json.candidates[0].content.parts[0].text.trim();
      
      // 응답이 유효한 카테고리인지 확인
      const matched = CATEGORIES.find(function(cat) {
        return answer.includes(cat);
      });
      
      if (matched) {
        Logger.log(`카테고리 분류: "${merchant}" → "${matched}"`);
        return matched;
      }
    }

    Logger.log(`카테고리 분류 실패 (기타로 처리): "${merchant}"`);
    return '기타';

  } catch (error) {
    Logger.log(`Gemini API 오류: ${error.toString()}`);
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
// 7. 테스트 함수 (개발용)
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
