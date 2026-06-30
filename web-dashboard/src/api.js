/* ============================================
   스마트 가계부 - Google Apps Script API 연동 모듈
   ============================================
   
   웹 대시보드에서 Google Apps Script 백엔드와 통신하는 모듈입니다.
   설정 화면에서 입력한 Apps Script URL을 사용합니다.
   ============================================ */

const API_TIMEOUT = 15000; // 15초 타임아웃

/**
 * Apps Script API를 호출합니다.
 * @param {string} appsScriptUrl - Apps Script 배포 URL
 * @param {Object} params - GET 파라미터
 * @returns {Promise<Object>} API 응답 데이터
 */
export async function fetchFromApi(appsScriptUrl, params = {}) {
  if (!appsScriptUrl) {
    throw new Error('Apps Script URL이 설정되지 않았습니다.');
  }

  const url = new URL(appsScriptUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`API 응답 오류: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || '알 수 없는 오류');
    }

    return data.data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 해당 월의 거래 내역을 가져옵니다.
 */
export async function getTransactions(appsScriptUrl, year, month) {
  return fetchFromApi(appsScriptUrl, {
    action: 'transactions',
    year: String(year),
    month: String(month),
  });
}

/**
 * 해당 월의 요약 데이터를 가져옵니다.
 */
export async function getSummary(appsScriptUrl, year, month) {
  return fetchFromApi(appsScriptUrl, {
    action: 'summary',
    year: String(year),
    month: String(month),
  });
}

/**
 * 카드 설정 목록을 가져옵니다.
 */
export async function getCards(appsScriptUrl) {
  return fetchFromApi(appsScriptUrl, {
    action: 'cards',
  });
}

/**
 * API가 연결 가능한 상태인지 테스트합니다.
 */
export async function testConnection(appsScriptUrl) {
  try {
    const data = await fetchFromApi(appsScriptUrl, { action: 'cards' });
    return { connected: true, data };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}
