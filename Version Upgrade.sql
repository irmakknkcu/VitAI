-- VitAI v2 Migration
-- Yeni sütunları profiles tablosuna ekle

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hemoglobin     FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS glucose        FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cholesterol    FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_d      FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_calories_taken INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_calories_goal  INT DEFAULT 0;

-- lab_results tablosunda NULL olan eski kayıtları 0'a çek
UPDATE lab_results SET hemoglobin  = 0 WHERE hemoglobin  IS NULL;
UPDATE lab_results SET glucose     = 0 WHERE glucose     IS NULL;
UPDATE lab_results SET cholesterol = 0 WHERE cholesterol IS NULL;
UPDATE lab_results SET vitamin_d   = 0 WHERE vitamin_d   IS NULL;

-- Mevcut kullanıcılar için TDEE bazlı kalori hedefini hesaplayıp kaydet
UPDATE profiles
SET daily_calories_goal = ROUND(
  (CASE gender
     WHEN 'male'   THEN 10*weight + 6.25*height - 5*age + 5
     ELSE               10*weight + 6.25*height - 5*age - 161
   END) * activity
)
WHERE weight > 0 AND height > 0 AND age > 0 AND daily_calories_goal = 0;
