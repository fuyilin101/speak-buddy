ALTER TABLE chat_profiles ADD COLUMN age_group TEXT;
ALTER TABLE chat_profiles ADD COLUMN english_level TEXT;
ALTER TABLE chat_profiles ADD COLUMN learning_goals TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chat_profiles ADD COLUMN profile_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_profiles ADD COLUMN profile_completed_at TEXT;
