import { redirect } from 'next/navigation';

// 콘솔 홈은 작업 기능과 함께 만든다 (3단계). 그전에는 세션부터 보여 준다.
export default function AdminHome() {
  redirect('/admin/sessions');
}
