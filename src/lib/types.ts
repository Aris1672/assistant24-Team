export type Profile = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

export type Channel = {
  id: string;
  name: string | null;
  is_dm: boolean;
  created_by: string | null;
  created_at: string;
};

export type ChannelMember = {
  channel_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
};

export type Attachment = {
  id: string;
  message_id: string;
  channel_id: string;
  uploader_id: string;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  edited_at: string | null;
  sender?: Profile;
  attachments?: Attachment[];
};

export type ChannelWithMeta = Channel & {
  members: Profile[];
  lastMessage?: Message | null;
  unreadCount: number;
};
