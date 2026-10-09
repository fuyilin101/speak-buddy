-- Single-statement ledger awards plus atomic trigger-maintained caches.
ALTER TABLE xp_events ADD COLUMN day TEXT;
UPDATE xp_events SET day=date(created_at,'+8 hours') WHERE day IS NULL;
CREATE INDEX xp_events_day ON xp_events(user_id,day);
CREATE TRIGGER growth_event_apply AFTER INSERT ON xp_events BEGIN
 INSERT INTO growth_profiles(user_id,xp,level,updated_at) VALUES(NEW.user_id,NEW.amount,1,NEW.created_at)
 ON CONFLICT(user_id) DO UPDATE SET xp=xp+NEW.amount,updated_at=NEW.created_at;
 INSERT INTO daily_growth(user_id,day,xp,chat_turns) VALUES(NEW.user_id,NEW.day,NEW.amount,0)
 ON CONFLICT(user_id,day) DO UPDATE SET xp=xp+NEW.amount;
END;
-- Recover aggregate caches from the trusted ledger; no historical events removed.
INSERT INTO growth_profiles(user_id,xp,level,updated_at) SELECT user_id,SUM(amount),1,MAX(created_at) FROM xp_events GROUP BY user_id
ON CONFLICT(user_id) DO UPDATE SET xp=excluded.xp,updated_at=excluded.updated_at;
UPDATE daily_growth SET xp=COALESCE((SELECT SUM(amount) FROM xp_events WHERE xp_events.user_id=daily_growth.user_id AND xp_events.day=daily_growth.day),0);
CREATE TABLE growth_chat_events(user_id TEXT NOT NULL,request_id TEXT NOT NULL,day TEXT NOT NULL,text_key TEXT NOT NULL,PRIMARY KEY(user_id,request_id),UNIQUE(user_id,day,text_key));
CREATE TABLE practice_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,mode TEXT NOT NULL,topic TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE practice_turns(user_id TEXT NOT NULL,session_id TEXT NOT NULL,request_id TEXT NOT NULL,message TEXT NOT NULL,reply_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,request_id));
