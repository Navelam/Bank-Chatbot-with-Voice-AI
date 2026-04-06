import csv
import sqlite3

def import_csv_to_db():
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    
    # Create faq table if not exists
    c.execute('''CREATE TABLE IF NOT EXISTS faq
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  question TEXT UNIQUE NOT NULL,
                  answer TEXT NOT NULL)''')
    
    with open('questions.csv', 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        count = 0
        for row in reader:
            question = row['question'].strip().lower()
            answer = row['answer'].strip()
            # Skip empty questions or section headers (those starting with **)
            if question and not question.startswith('**'):
                try:
                    c.execute("INSERT INTO faq (question, answer) VALUES (?, ?)", 
                             (question, answer))
                    count += 1
                except sqlite3.IntegrityError:
                    # Question already exists, update it
                    c.execute("UPDATE faq SET answer = ? WHERE question = ?", 
                             (answer, question))
                    count += 1
    
    conn.commit()
    conn.close()
    print(f" Imported/Updated {count} FAQs successfully!")

if __name__ == '__main__':
    import_csv_to_db()