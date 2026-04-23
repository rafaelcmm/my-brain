import { redirect } from "next/navigation";
import { resolveSessionBearer } from "@/lib/composition/auth";
import { LoginForm } from "@/app/login/login-form";

/**
 * Login route redirects already-authenticated users to dashboard.
 */
export default async function LoginPage() {
  const session = await resolveSessionBearer();

  if (session) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
