/* ============================================
   스마트 가계부 - Main Application Logic
   ============================================ */

import './style.css';
import { getTransactions, testConnection } from './api.js';

// ==========================================
// 1. 데이터 & 상태 관리
// ==========================================

const STORAGE_KEY = 'smart-budget-data';
const CATEGORIES = ['밥', '육아', '카페', '쇼핑', '여가', '마트', '헌금', '병원', '선물', '기타', '수입', '공과금'];

const CATEGORY_ICONS = {
  '밥': '🍚', '육아': '👶', '카페': '☕', '쇼핑': '🛍️',
  '여가': '🎬', '마트': '🛒', '헌금': '⛪', '병원': '🏥',
  '선물': '🎁', '기타': '📦', '수입': '💰', '공과금': '📋'
};

const CATEGORY_COLORS = {
  '밥': '#f59e0b', '육아': '#ec4899', '카페': '#8b5cf6', '쇼핑': '#3b82f6',
  '여가': '#14b8a6', '마트': '#10b981', '헌금': '#6366f1', '병원': '#ef4444',
  '선물': '#f97316', '기타': '#6b7280', '수입': '#22c55e', '공과금': '#64748b'
};

const DEFAULT_CARDS = [
  { id: '1', name: '신한카드', type: 'credit', limit: 0, color: '#3b82f6' },
  { id: '2', name: 'NH농협카드', type: 'credit', limit: 340000, color: '#10b981' },
  { id: '3', name: '현대카드', type: 'credit', limit: 300000, color: '#ffffff' },
  { id: '4', name: '하나카드', type: 'credit', limit: 300000, color: '#14b8a6' },
  { id: '5', name: '인천이음카드', type: 'local', limit: 0, color: '#6366f1' },
  { id: '6', name: '부천페이', type: 'local', limit: 0, color: '#8b5cf6' }
];

// 더미 거래 데이터 (시연용) -> 빈 배열로 초기화 (실제 데이터 수집용)
const DEMO_TRANSACTIONS = [];

// 앱 상태
let state = {
  currentTab: 'home',
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  cards: [...DEFAULT_CARDS],
  transactions: [...DEMO_TRANSACTIONS],
  settings: {
    initialBalance: 1250000,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/1V1BasMP3sl0BPHgwMC8e0bghepB8lTmmGaOOBo_sdPc/edit?usp=sharing',
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwfsUMwjEZZ26cgaM7B6yoRUc738UxrlxI6OcPqSAc6kO_iwilD6Ft0XYWhaabF-7hwTg/exec'
  }
};

// ==========================================
// 2. 유틸리티 함수
// ==========================================

function formatCurrency(amount) {
  return '₩' + amount.toLocaleString('ko-KR');
}

function formatCurrencyShort(amount) {
  if (amount >= 10000) {
    return (amount / 10000).toFixed(amount % 10000 === 0 ? 0 : 1) + '만';
  }
  return amount.toLocaleString('ko-KR');
}

function getMonthLabel(year, month) {
  return `${year}년 ${month}월`;
}

function getMonthTransactions(year, month) {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  return state.transactions.filter(t => t.date.startsWith(monthStr));
}

function getCardById(cardId) {
  return state.cards.find(c => c.id === cardId);
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * 시트의 카드명과 대시보드 카드 이름을 유사 매칭합니다.
 * 예: '신한' → '신한카드', '이음카드' → '인천이음카드', 'NH농협' → 'NH농협카드'
 */
function findMatchingCard(sheetCardName) {
  if (!sheetCardName) return null;
  const name = sheetCardName.trim();
  
  // 1. 정확히 일치
  const exact = state.cards.find(c => c.name === name);
  if (exact) return exact;
  
  // 2. 시트 이름이 카드 이름에 포함되거나, 카드 이름이 시트 이름에 포함
  const partial = state.cards.find(c => 
    c.name.includes(name) || name.includes(c.name)
  );
  if (partial) return partial;
  
  // 3. 핵심 키워드 매칭 (카드 → 빼고 비교)
  const CARD_ALIASES = {
    '신한': '신한카드',
    '하나': '하나카드',
    '현대': '현대카드',
    '국민': '국민카드',
    'KB': '국민카드',
    '농협': 'NH농협카드',
    'NH': 'NH농협카드',
    '이음': '인천이음카드',
    '부천': '부천페이',
  };
  
  for (const [keyword, cardName] of Object.entries(CARD_ALIASES)) {
    if (name.includes(keyword)) {
      const matched = state.cards.find(c => c.name === cardName);
      if (matched) return matched;
    }
  }
  
  return null;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cards: state.cards,
      transactions: state.transactions,
      settings: state.settings
    }));
  } catch (e) { /* ignore */ }
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (data.cards) state.cards = data.cards;
      if (data.transactions) state.transactions = data.transactions;
      if (data.settings) {
        state.settings = { ...state.settings, ...data.settings };
        // 로컬에 빈 값이 저장된 경우 기본값 강제 적용
        if (!state.settings.sheetUrl) {
          state.settings.sheetUrl = 'https://docs.google.com/spreadsheets/d/1V1BasMP3sl0BPHgwMC8e0bghepB8lTmmGaOOBo_sdPc/edit?usp=sharing';
        }
        if (!state.settings.appsScriptUrl) {
          state.settings.appsScriptUrl = 'https://script.google.com/macros/s/AKfycbwfsUMwjEZZ26cgaM7B6yoRUc738UxrlxI6OcPqSAc6kO_iwilD6Ft0XYWhaabF-7hwTg/exec';
        }
      }
    }
  } catch (e) { /* ignore */ }
}

// ==========================================
// 3. 네비게이션
// ==========================================

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      switchTab(tab);
    });
  });

  // "전체보기" 링크
  document.querySelectorAll('[data-navigate]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.navigate));
  });

  // 월 네비게이션
  document.getElementById('prevMonth').addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 1) {
      state.currentMonth = 12;
      state.currentYear--;
    }
    updateAll();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 12) {
      state.currentMonth = 1;
      state.currentYear++;
    }
    updateAll();
  });
}

function switchTab(tab) {
  state.currentTab = tab;

  // 페이지 전환
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById(`page-${tab}`);
  if (targetPage) targetPage.classList.add('active');

  // 네비게이션 활성화
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navItem) navItem.classList.add('active');

  // 탭별 렌더링
  if (tab === 'analysis') renderAnalysis();
  if (tab === 'settings') renderSettings();
}

// ==========================================
// 4. 홈 탭 렌더링
// ==========================================

function renderHome() {
  const txns = getMonthTransactions(state.currentYear, state.currentMonth);
  const totalSpending = txns.reduce((sum, t) => sum + t.amount, 0);

  // 총 지출
  document.getElementById('totalSpending').textContent = formatCurrency(totalSpending);
  document.getElementById('transactionCount').textContent = `${txns.length}건 결제`;

  // 헤더 날짜
  document.getElementById('headerSubtitle').textContent = getMonthLabel(state.currentYear, state.currentMonth);

  // 카드 스크롤
  renderCardScroll(txns);

  // 최근 거래 내역
  renderTransactionList(txns);
}

function renderCardScroll(txns) {
  const container = document.getElementById('cardGridHome');
  if (!container) return;
  container.innerHTML = '';

  state.cards.forEach((card, index) => {
    const cardTxns = txns.filter(t => t.cardId === card.id);
    const cardTotal = cardTxns.reduce((sum, t) => sum + t.amount, 0);
    const hasLimit = card.limit > 0;
    const percent = hasLimit ? Math.min((cardTotal / card.limit) * 100, 100) : 0;

    const el = document.createElement('div');
    el.className = 'card-mini';
    el.style.cssText = `animation-delay: ${index * 0.05}s;`;
    el.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${card.color};border-radius:16px 16px 0 0;"></div>
      <div class="card-mini-name">${card.name}</div>
      <div class="card-mini-amount" style="color:${card.color}">${formatCurrency(cardTotal)}</div>
      ${hasLimit ? `
        <div class="card-mini-progress">
          <div class="card-mini-progress-fill" style="width:${percent}%;background:${card.color};"></div>
        </div>
        <div class="card-mini-limit">/ ${formatCurrency(card.limit)}</div>
      ` : `
        <div class="card-mini-limit" style="color:var(--text-tertiary);">실적 제한 없음</div>
      `}
    `;
    el.addEventListener('click', () => switchTab('cards'));
    container.appendChild(el);
  });
}

function renderTransactionList(txns) {
  const container = document.getElementById('transactionList');
  container.innerHTML = '';

  if (txns.length === 0) {
    container.innerHTML = `
      <div class="transaction-empty">
        <div class="transaction-empty-icon">📝</div>
        <div class="transaction-empty-text">이번 달 결제 내역이 없습니다</div>
      </div>
    `;
    return;
  }

  // 날짜 기준 정렬 (최신 먼저)
  const sorted = [...txns].sort((a, b) => {
    const da = a.date + a.time;
    const db = b.date + b.time;
    return db.localeCompare(da);
  });

  sorted.forEach((txn, index) => {
    const card = getCardById(txn.cardId);
    const icon = CATEGORY_ICONS[txn.category] || '📦';
    const bgColor = CATEGORY_COLORS[txn.category] || '#6b7280';
    const dateObj = new Date(txn.date);
    const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

    const el = document.createElement('div');
    el.className = 'transaction-item';
    el.style.animationDelay = `${index * 0.04}s`;
    el.innerHTML = `
      <div class="transaction-icon" style="background:${bgColor}20;">${icon}</div>
      <div class="transaction-info">
        <div class="transaction-merchant">${txn.merchant}</div>
        <div class="transaction-meta">
          <span class="transaction-category">${txn.category}</span>
          <span class="transaction-card">${card ? card.name : ''}</span>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="transaction-amount">-${formatCurrency(txn.amount)}</div>
        <div class="transaction-time">${dateLabel} ${txn.time}</div>
      </div>
    `;
    container.appendChild(el);
  });
}

// ==========================================
// 5. 카드 탭 렌더링
// ==========================================

function renderCards() {
  const container = document.getElementById('cardsGrid');
  container.innerHTML = '';
  const txns = getMonthTransactions(state.currentYear, state.currentMonth);

  state.cards.forEach((card, index) => {
    const cardTxns = txns.filter(t => t.cardId === card.id);
    const cardTotal = cardTxns.reduce((sum, t) => sum + t.amount, 0);
    const hasLimit = card.limit > 0;
    const percent = hasLimit ? Math.min((cardTotal / card.limit) * 100, 100) : 0;
    const remaining = hasLimit ? card.limit - cardTotal : 0;

    const el = document.createElement('div');
    el.className = 'card-full';
    el.style.animationDelay = `${index * 0.06}s`;

    let progressColor = card.color;
    if (hasLimit && percent >= 100) progressColor = '#10b981';
    else if (hasLimit && percent >= 80) progressColor = '#f59e0b';

    el.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:4px;background:${card.color};"></div>
      <div class="card-full-header">
        <span class="card-full-name">${card.name}</span>
        <span class="card-full-type">${card.type === 'credit' ? '신용카드' : '지역화폐'}</span>
      </div>
      <div class="card-full-amount-row">
        <span class="card-full-amount" style="color:${card.color}">${formatCurrency(cardTotal)}</span>
        ${hasLimit ? `<span class="card-full-limit-label">/ ${formatCurrency(card.limit)}</span>` : ''}
      </div>
      ${hasLimit ? `
        <div class="card-full-progress">
          <div class="card-full-progress-fill" style="width:${percent}%;background:${progressColor};"></div>
        </div>
        <div class="card-full-footer">
          <span class="card-full-percent" style="color:${progressColor}">${percent.toFixed(1)}% 달성</span>
          <span class="card-full-remaining">${remaining > 0 ? formatCurrency(remaining) + ' 남음' : '✅ 실적 달성!'}</span>
        </div>
      ` : `
        <div class="card-no-limit">
          <span>실적 제한 없음 · ${cardTxns.length}건 결제</span>
        </div>
      `}
    `;
    container.appendChild(el);
  });
}

// ==========================================
// 6. 분석 탭 렌더링
// ==========================================

function renderAnalysis() {
  const txns = getMonthTransactions(state.currentYear, state.currentMonth);
  const totalSpending = txns.reduce((sum, t) => sum + t.amount, 0);

  // 카테고리별 집계
  const categoryData = {};
  CATEGORIES.forEach(cat => { categoryData[cat] = 0; });
  txns.forEach(t => {
    if (categoryData[t.category] !== undefined) {
      categoryData[t.category] += t.amount;
    }
  });

  // 도넛 차트 그리기
  renderDonutChart(categoryData, totalSpending);

  // 범례
  renderCategoryLegend(categoryData);

  // 일별 바 차트
  renderBarChart(txns);
}

function renderDonutChart(categoryData, total) {
  const svg = document.getElementById('donutChart');
  svg.innerHTML = '';

  document.getElementById('donutCenterAmount').textContent = formatCurrency(total);

  const radius = 75;
  const cx = 100;
  const cy = 100;
  const strokeWidth = 28;

  const entries = Object.entries(categoryData).filter(([, v]) => v > 0);

  if (entries.length === 0) {
    // 빈 원
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'rgba(255,255,255,0.06)');
    circle.setAttribute('stroke-width', strokeWidth);
    svg.appendChild(circle);
    return;
  }

  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  entries.forEach(([cat, amount]) => {
    const ratio = amount / total;
    const dashLength = ratio * circumference;
    const color = CATEGORY_COLORS[cat] || '#6b7280';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', strokeWidth);
    circle.setAttribute('stroke-dasharray', `${dashLength} ${circumference - dashLength}`);
    circle.setAttribute('stroke-dashoffset', `${-offset}`);
    circle.setAttribute('stroke-linecap', 'butt');
    circle.style.transition = 'stroke-dasharray 1s ease, stroke-dashoffset 1s ease';
    svg.appendChild(circle);

    offset += dashLength;
  });
}

function renderCategoryLegend(categoryData) {
  const container = document.getElementById('categoryLegend');
  container.innerHTML = '';

  const entries = Object.entries(categoryData)
    .sort(([, a], [, b]) => b - a);

  entries.forEach(([cat, amount]) => {
    if (amount === 0) return;
    const color = CATEGORY_COLORS[cat] || '#6b7280';
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `
      <div class="legend-dot" style="background:${color};"></div>
      <span class="legend-label">${cat}</span>
      <span class="legend-value">${formatCurrency(amount)}</span>
    `;
    container.appendChild(el);
  });
}

function renderBarChart(txns) {
  const container = document.getElementById('barChartContainer');
  container.innerHTML = '';

  // 일별 집계
  const dailyData = {};
  const daysInMonth = new Date(state.currentYear, state.currentMonth, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    dailyData[d] = 0;
  }

  txns.forEach(t => {
    const day = parseInt(t.date.split('-')[2]);
    dailyData[day] = (dailyData[day] || 0) + t.amount;
  });

  const maxVal = Math.max(...Object.values(dailyData), 1);

  // 날짜가 많으면 5일 단위로 라벨 표시
  Object.entries(dailyData).forEach(([day, amount]) => {
    const dayNum = parseInt(day);
    const heightPercent = (amount / maxVal) * 100;
    const color = amount > 0 ? 'var(--accent-indigo)' : 'rgba(255,255,255,0.04)';

    const el = document.createElement('div');
    el.className = 'bar-item';
    el.innerHTML = `
      <div class="bar-fill" style="height:${Math.max(heightPercent, 2)}%;background:${color};">
        ${amount > 0 ? `<div class="bar-tooltip">${formatCurrencyShort(amount)}</div>` : ''}
      </div>
      ${dayNum % 5 === 1 || dayNum === daysInMonth ? `<div class="bar-label">${dayNum}</div>` : `<div class="bar-label"></div>`}
    `;
    container.appendChild(el);
  });
}

// ==========================================
// 7. 설정 탭 렌더링
// ==========================================

function renderSettings() {
  const container = document.getElementById('settingsCardList');
  container.innerHTML = '';

  state.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'settings-card-item';
    el.innerHTML = `
      <div class="settings-card-dot" style="background:${card.color};"></div>
      <div class="settings-card-info">
        <div class="settings-card-name">${card.name}</div>
        <div class="settings-card-detail">${card.type === 'credit' ? '신용카드' : '지역화폐'}${card.limit > 0 ? ' · 실적 ' + formatCurrency(card.limit) : ''}</div>
      </div>
      <div class="settings-card-actions">
        <button class="edit" data-card-id="${card.id}" title="수정">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.388 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.581 14.5032 3.8262 14.4084 4.05497C14.3137 4.28375 14.1748 4.49161 13.9997 4.66671L4.99967 13.6667L1.33301 14.6667L2.33301 11L11.333 2.00004Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="delete" data-card-id="${card.id}" title="삭제">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M5.333 4V2.667C5.333 2.313 5.474 1.974 5.724 1.724C5.974 1.474 6.313 1.333 6.667 1.333H9.333C9.687 1.333 10.026 1.474 10.276 1.724C10.526 1.974 10.667 2.313 10.667 2.667V4M6.667 7.333V11.333M9.333 7.333V11.333M12.667 4V13.333C12.667 13.687 12.526 14.026 12.276 14.276C12.026 14.526 11.687 14.667 11.333 14.667H4.667C4.313 14.667 3.974 14.526 3.724 14.276C3.474 14.026 3.333 13.687 3.333 13.333V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `;

    // 수정 버튼
    el.querySelector('.edit').addEventListener('click', () => openCardModal(card));
    // 삭제 버튼
    el.querySelector('.delete').addEventListener('click', () => deleteCard(card.id));

    container.appendChild(el);
  });

  // 설정값 반영
  document.getElementById('initialBalance').value = state.settings.initialBalance.toLocaleString();
  document.getElementById('sheetUrl').value = state.settings.sheetUrl;
  document.getElementById('appsScriptUrl').value = state.settings.appsScriptUrl;
}

// ==========================================
// 8. 카드 모달 (추가/수정)
// ==========================================

let selectedColor = '#6366f1';

function initCardModal() {
  const modal = document.getElementById('cardModal');
  const closeBtn = document.getElementById('modalClose');
  const cancelBtn = document.getElementById('modalCancelBtn');
  const addBtn = document.getElementById('addCardBtn');
  const form = document.getElementById('cardForm');

  addBtn.addEventListener('click', () => openCardModal(null));
  closeBtn.addEventListener('click', closeCardModal);
  cancelBtn.addEventListener('click', closeCardModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCardModal();
  });

  // 색상 선택
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      selectedColor = swatch.dataset.color;
    });
  });

  // 폼 제출
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const editId = document.getElementById('cardEditId').value;
    const name = document.getElementById('cardName').value.trim();
    const type = document.getElementById('cardType').value;
    const limitVal = document.getElementById('cardLimit').value.replace(/[,\s]/g, '');
    const limit = limitVal ? parseInt(limitVal) : 0;

    if (!name) {
      showToast('카드 이름을 입력해주세요', 'error');
      return;
    }

    if (editId) {
      // 수정
      const idx = state.cards.findIndex(c => c.id === editId);
      if (idx !== -1) {
        state.cards[idx] = { ...state.cards[idx], name, type, limit, color: selectedColor };
        showToast('카드가 수정되었습니다');
      }
    } else {
      // 추가
      state.cards.push({
        id: generateId(),
        name,
        type,
        limit,
        color: selectedColor
      });
      showToast('새 카드가 추가되었습니다');
    }

    saveState();
    closeCardModal();
    updateAll();
  });
}

function openCardModal(card) {
  const modal = document.getElementById('cardModal');
  const title = document.getElementById('modalTitle');

  if (card) {
    title.textContent = '카드 수정';
    document.getElementById('cardEditId').value = card.id;
    document.getElementById('cardName').value = card.name;
    document.getElementById('cardType').value = card.type;
    document.getElementById('cardLimit').value = card.limit > 0 ? card.limit.toLocaleString() : '';
    selectedColor = card.color;
  } else {
    title.textContent = '새 카드 추가';
    document.getElementById('cardEditId').value = '';
    document.getElementById('cardName').value = '';
    document.getElementById('cardType').value = 'credit';
    document.getElementById('cardLimit').value = '';
    selectedColor = '#6366f1';
  }

  // 색상 선택 동기화
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === selectedColor);
  });

  modal.classList.add('active');
}

function closeCardModal() {
  document.getElementById('cardModal').classList.remove('active');
}

function deleteCard(cardId) {
  if (state.cards.length <= 1) {
    showToast('최소 1개의 카드가 필요합니다', 'error');
    return;
  }
  state.cards = state.cards.filter(c => c.id !== cardId);
  saveState();
  showToast('카드가 삭제되었습니다');
  updateAll();
}

// ==========================================
// 9. 설정 저장
// ==========================================

function initSettings() {
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const balanceStr = document.getElementById('initialBalance').value.replace(/[,\s₩]/g, '');
    state.settings.initialBalance = parseInt(balanceStr) || 0;
    state.settings.sheetUrl = document.getElementById('sheetUrl').value;
    state.settings.appsScriptUrl = document.getElementById('appsScriptUrl').value;
    saveState();
    showToast('설정이 저장되었습니다');

    // Apps Script URL이 있으면 연결 테스트
    if (state.settings.appsScriptUrl) {
      showToast('API 연결 테스트 중...');
      const result = await testConnection(state.settings.appsScriptUrl);
      if (result.connected) {
        showToast('✅ API 연결 성공! 실제 데이터를 불러옵니다.');
        await loadFromApi();
        updateAll();
      } else {
        showToast('❌ API 연결 실패: ' + result.error, 'error');
      }
    }
  });
}

// ==========================================
// 10. 전체 업데이트
// ==========================================

function updateAll() {
  renderHome();
  renderCards();
  if (state.currentTab === 'analysis') renderAnalysis();
  if (state.currentTab === 'settings') renderSettings();
}

// ==========================================
// 11. API 데이터 로드
// ==========================================

/**
 * Apps Script API에서 실제 데이터를 불러와 state에 반영합니다.
 * URL이 설정되어 있지 않으면 더미 데이터를 유지합니다.
 */
async function loadFromApi() {
  if (!state.settings.appsScriptUrl) return;

  try {
    const result = await getTransactions(
      state.settings.appsScriptUrl,
      state.currentYear,
      state.currentMonth
    );

    if (result && result.transactions) {
      // API 데이터를 state에 반영 (카드 이름 유사 매칭)
      state.transactions = result.transactions.map(t => {
        const card = findMatchingCard(t.card);
        return {
          ...t,
          cardId: card ? card.id : '',
        };
      });
    }
  } catch (error) {
    console.warn('API 데이터 로드 실패, 로컬 데이터 사용:', error.message);
  }
}

// ==========================================
// 12. 초기화
// ==========================================

async function init() {
  loadState();
  initNavigation();
  initCardModal();
  initSettings();

  // 1. 로컬 데이터로 즉시 화면 렌더링 (로딩 지연 제거)
  updateAll();

  // 2. 백그라운드에서 API 최신 데이터 로드
  if (state.settings.appsScriptUrl) {
    try {
      await loadFromApi();
      saveState();
      updateAll(); // 최신 데이터로 화면 갱신
    } catch (e) {
      console.warn('백그라운드 업데이트 실패', e);
    }
  }
}

// DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
