import { redirect } from "next/navigation";

/**
 * Legacy editor route retained for backward compatibility.
 */
export default function EditorRedirectPage() {
  redirect("/memories/new");
}
