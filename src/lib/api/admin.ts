import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';

// admin-get-users reads its parameters from the query string, which
// supabase.functions.invoke cannot send — so this fetches the function
// directly with the session's bearer token.

export interface AdminUserRow {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchAdminUsers(page = 1, search = ''): Promise<AdminUsersPage> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = new URL(`${supabaseUrl}/functions/v1/admin-get-users`);
  url.searchParams.set('page', String(page));
  if (search) url.searchParams.set('search', search);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: supabaseAnonKey,
    },
  });
  if (!res.ok) throw new Error(`admin-get-users failed (${res.status})`);
  return res.json();
}
