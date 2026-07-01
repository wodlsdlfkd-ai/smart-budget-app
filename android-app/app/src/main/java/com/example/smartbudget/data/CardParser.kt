package com.example.smartbudget.data

/**
 * 카드사별 독립적인 파싱 규칙을 정의하는 인터페이스
 */
interface CardParser {
    /**
     * 알림 텍스트 데이터를 분석하여 Transaction 객체로 파싱합니다.
     * 
     * @param title 알림의 title 필드
     * @param text 알림의 text 필드
     * @param bigText 알림의 bigText 필드 (여러 줄 텍스트가 주로 여기에 들어옵니다)
     * @param textLines 알림의 textLines 필드 (InboxStyle의 경우)
     * @return 파싱에 성공하면 Transaction 객체, 실패하면 null을 반환합니다.
     */
    fun parse(
        title: String,
        text: String,
        bigText: String,
        textLines: String
    ): CardTransactionParser.Transaction?
}
