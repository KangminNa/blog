import { ApprovalDetail } from '../ApprovalDetail';

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApprovalDetail key={id} id={id} />;
}
