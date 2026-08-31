import { supabase } from '@/lib/supabase';
import { dbChatMessageToApp, dbChatToApp } from '@/lib/mappers';
import type { Chat, ChatMessage } from '@/lib/types';

// Data access for chats, messages and feedback, plus the `chat` Edge Function
// call. Queries moved verbatim from AppContext (SYL-36).

export async function fetchChats() {
  const { data, error } = await supabase
    .from('chats')
    .select('*, chat_courses(course_id)')
    .order('created_at', { ascending: false });
  const chats: Chat[] = (data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any) => dbChatToApp(row, (row.chat_courses ?? []).map((cc: any) => cc.course_id))
  );
  return { data: chats, error };
}

export async function fetchChatMessages(chatId: string) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('sequence', { ascending: true });
  return { data: (data ?? []).map(dbChatMessageToApp), error };
}

export async function createChat(
  userId: string,
  semesterId: string,
  title: string | null,
  courseIds: string[]
) {
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: userId, semester_id: semesterId, title })
    .select()
    .single();
  return { data: data ? dbChatToApp(data, courseIds) : null, error };
}

export async function linkChatCourses(chatId: string, courseIds: string[]) {
  return supabase
    .from('chat_courses')
    .insert(courseIds.map(cid => ({ chat_id: chatId, course_id: cid })));
}

export async function insertChatMessage(
  chatId: string,
  sequence: number,
  role: ChatMessage['role'],
  content: string
) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ chat_id: chatId, sequence, role, content })
    .select()
    .single();
  return { data: data ? dbChatMessageToApp(data) : null, error };
}

export async function deleteChat(chatId: string) {
  await supabase.from('chat_messages').delete().eq('chat_id', chatId);
  await supabase.from('chat_courses').delete().eq('chat_id', chatId);
  return supabase.from('chats').delete().eq('id', chatId);
}

export async function renameChat(chatId: string, title: string) {
  return supabase.from('chats').update({ title }).eq('id', chatId);
}

export async function insertChatFeedback(feedback: {
  userId: string;
  chatId: string;
  semesterId: string | null;
  courseIds: string[];
  reportedAtSequence: number | null;
  description: string;
  conversationSnapshot: Array<{ role: string; content: string; sequence?: number }>;
}) {
  return supabase.from('chat_feedback').insert({
    user_id: feedback.userId,
    chat_id: feedback.chatId,
    semester_id: feedback.semesterId,
    course_ids: feedback.courseIds,
    reported_at_sequence: feedback.reportedAtSequence,
    description: feedback.description,
    conversation_snapshot: feedback.conversationSnapshot,
  });
}

/** Invokes the `chat` Edge Function. Returns its raw payload. */
export async function sendChatQuery(body: {
  message: string;
  semester_id: string;
  conversation_history: Array<{ role: string; content: string }>;
  course_ids: string[];
}) {
  return supabase.functions.invoke('chat', { body });
}
