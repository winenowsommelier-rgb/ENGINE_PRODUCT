import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Reset your password</h1>
      <ForgotPasswordForm />
      <p className="mt-4 text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
