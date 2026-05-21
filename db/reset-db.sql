-- VitAI veritabanını sıfırla ve doğru şemayla yeniden oluştur
-- Tüm veriler silinir! Kullanım: mysql -u root < db/reset-db.sql

DROP DATABASE IF EXISTS vitai;
CREATE DATABASE vitai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vitai;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    surname VARCHAR(100) DEFAULT '',
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profiles (
    user_id INT PRIMARY KEY,
    age INT DEFAULT 0,
    gender ENUM('male','female') DEFAULT 'female',
    height DECIMAL(5,1) DEFAULT 0,
    weight DECIMAL(5,1) DEFAULT 0,
    goal DECIMAL(5,1) DEFAULT 0,
    activity DECIMAL(4,3) DEFAULT 1.200,
    daily_calories_taken INT DEFAULT 0,
    daily_calories_goal INT DEFAULT 0,
    diet_type VARCHAR(50) DEFAULT '',
    allergies TEXT,
    dislikes TEXT,
    budget_level ENUM('low','medium','high') DEFAULT 'medium',
    cook_time_pref INT DEFAULT 30,
    hemoglobin FLOAT DEFAULT 0,
    glucose FLOAT DEFAULT 0,
    cholesterol FLOAT DEFAULT 0,
    vitamin_d FLOAT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE food_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    calories INT NOT NULL,
    meal_type ENUM('Breakfast','Lunch','Dinner','Snack') NOT NULL,
    log_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE exercise_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(100) NOT NULL,
    duration INT NOT NULL,
    calories DECIMAL(10,2) NOT NULL,
    steps INT NOT NULL DEFAULT 0,
    source VARCHAR(50) DEFAULT NULL,
    log_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE watch_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    log_date DATE NOT NULL,
    steps INT NOT NULL DEFAULT 0,
    calories DECIMAL(10,2) NOT NULL DEFAULT 0,
    source VARCHAR(50) NOT NULL DEFAULT 'apple_health',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_user_date (user_id, log_date)
);

CREATE TABLE weight_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    weight DECIMAL(5,1) NOT NULL,
    log_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE lab_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    hemoglobin DECIMAL(6,2),
    glucose DECIMAL(6,2),
    cholesterol DECIMAL(6,2),
    vitamin_d DECIMAL(6,2),
    log_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    role ENUM('user','assistant') NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
