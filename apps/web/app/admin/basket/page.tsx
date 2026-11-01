import { BasketPanel } from './BasketPanel';

export const metadata = { title: '소재 · Cairn', robots: { index: false } };

export default function BasketPage() {
  return (
    <section className="console-inner narrow" aria-label="소재">
      <header className="page-head">
        <h1>소재</h1>
      </header>
      <BasketPanel />
    </section>
  );
}
