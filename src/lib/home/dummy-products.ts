import type { ProductCardData } from "@/components/products/ProductCard";

/** Legacy helpers — homepage no longer fills with dummy catalog data. */
export const DUMMY_HOME_PRODUCTS: ProductCardData[] = [];

export function shuffleProducts<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function fillWithDummy(products: ProductCardData[]): ProductCardData[] {
  return products;
}
