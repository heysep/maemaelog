/** 인앱결제 상품 SKU 상수 */
export interface Product {
  sku: string;
  name: string;
  priceLabel: string;
  desc: string;
}

export const PRODUCTS: Product[] = [
  {
    sku: 'maemaelog.pro.monthly',
    name: '프로',
    priceLabel: '월 3,000원',
    desc: 'AI 정밀 인식 + 습관 분석 하루 3회 + 기록 무제한 + 광고 제거',
  },
  {
    sku: 'maemaelog.records.monthly',
    name: '기록 무제한',
    priceLabel: '월 500원',
    desc: '기록 30건 제한 해제',
  },
  {
    sku: 'maemaelog.noads.monthly',
    name: '광고 제거',
    priceLabel: '월 500원',
    desc: '배너 광고 제거 + OCR 광고 면제',
  },
];

import type { EntKey } from '../core/limits';

export function entKeyForSku(sku: string): EntKey | null {
  if (sku === 'maemaelog.pro.monthly') return 'pro';
  if (sku === 'maemaelog.records.monthly') return 'records';
  if (sku === 'maemaelog.noads.monthly') return 'noads';
  return null;
}

/** 월 구독 만료일: 결제 시점 + 31일 (클라이언트 저장 기반 근사) */
export const ENTITLEMENT_DAYS = 31;
