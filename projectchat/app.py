from flask import Flask, render_template, request, redirect, url_for, session, jsonify, Response
from flask_cors import CORS
import sqlite3
import hashlib
import csv
import os
from datetime import datetime
import io
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from gtts import gTTS
    TTS_AVAILABLE = True
    logger.info("gTTS library loaded successfully")
except ImportError:
    TTS_AVAILABLE = False
    logger.error("gTTS not installed. Run: pip install gtts")

app = Flask(__name__)
app.secret_key = 'your_secret_key_here_change_in_production'

CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

MAX_TTS_TEXT_LENGTH = 5000

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def init_db():
    conn = sqlite3.connect('database.db')
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE NOT NULL,
                  email TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    # faq table stores every row from the CSV as-is (question + answer).
    # Tamil questions and English questions are separate rows — both searchable.
    c.execute('''CREATE TABLE IF NOT EXISTS faq
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  question TEXT UNIQUE NOT NULL,
                  answer TEXT NOT NULL)''')

    c.execute('''CREATE TABLE IF NOT EXISTS chat_history
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  user_message TEXT,
                  bot_response TEXT,
                  language TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id))''')

    conn.commit()
    conn.close()
    logger.info("Database initialized successfully")


def import_csv_to_db():
    """Import questions.csv into the faq table.

    The CSV has Tamil and English questions as separate rows — both are
    imported directly so Tamil voice input can match Tamil questions.
    """
    if not os.path.exists('questions.csv'):
        logger.warning("questions.csv not found — skipping import")
        return

    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    count = 0

    with open('questions.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            question = (row.get('question') or '').strip()
            answer   = (row.get('answer')   or '').strip()

            # Skip blank rows or section-header rows
            if not question or not answer or question.startswith('**'):
                continue

            # Store Tamil questions as-is (do NOT lowercase — it corrupts script)
            # Store English questions in lowercase for case-insensitive matching
            key = question if _is_tamil(question) else question.lower()

            try:
                c.execute("INSERT INTO faq (question, answer) VALUES (?, ?)", (key, answer))
            except sqlite3.IntegrityError:
                c.execute("UPDATE faq SET answer = ? WHERE question = ?", (answer, key))
            count += 1

    conn.commit()
    conn.close()
    logger.info(f"Imported/updated {count} FAQ rows")


def _is_tamil(text: str) -> bool:
    """Return True if the text contains Tamil Unicode characters."""
    return any('\u0B80' <= ch <= '\u0BFF' for ch in text)


# ---------------------------------------------------------------------------
# Bot logic
# ---------------------------------------------------------------------------

# Maps keywords → FAQ question key in the DB.
# Sorted by keyword length (longest first) during lookup so
# "education loan" matches before the generic "loan".
KEYWORD_MAP = {
    # ── English: specific (long) phrases ───────────────────────────────────
    'education loan':      'loan',
    'home loan':           'வீட்டுக் கடன்',
    'personal loan':       'தனிப்பட்ட கடன்',
    'vehicle loan':        'loan',
    'car loan':            'loan',
    'loan document':       'loan documents',
    'loan interest':       'loan interest rate',
    'loan eligibility':    'how is my loan eligibility determined?',
    'loan apply':          'how can i apply for a personal loan?',
    'mobile number':       'update phone number',
    'phone number':        'update phone number',
    'customer care':       'customer care number',
    'credit card apply':   'credit card apply',
    'credit card lost':    'credit card lost',
    'credit card limit':   'how can i increase my credit card limit?',
    'fixed deposit':       'fixed deposit',
    'recurring deposit':   'recurring deposit',
    'savings account':     'savings account',
    'current account':     'what documents are required to open a current account?',
    'open account':        'open account online',
    'close account':       'how can i close my bank account?',
    'joint account':       'can i convert my savings account to a joint account?',
    'atm withdrawal':      'ஏடிஎம் எடுப்பு வரம்பு',
    'atm blocked':         'ஏடிஎம் கார்டு தடுக்கப்பட்டது',
    'atm card':            'ஏடிஎம் எடுப்பு வரம்பு',
    'debit card':          'how do i activate my new debit card?',
    'net banking':         'how do i register for online banking?',
    'online banking':      'how do i register for online banking?',
    'mobile banking':      'மொபைல் பேங்கிங்',
    'mobile app':          'மொபைல் பேங்கிங்',
    'forgot password':     'forgot password',
    'reset password':      'reset password',
    'minimum balance':     'minimum balance',
    'bank hours':          'bank hours',
    'branch near':         'bank branch near me',
    'nearest branch':      'bank branch near me',
    'cheque book':         'cheque book',
    'update phone':        'update phone number',
    'kyc update':          'kyc update',
    'pan linking':         'pan linking',
    'wire transfer':       'what are the charges for international wire transfers?',
    'account alert':       'how do i set up account alerts?',
    'direct deposit':      'can i set up direct deposit for my paycheck?',
    'safe deposit':        'does the bank offer safe deposit boxes?',
    'annual fee':          'are there annual fees for credit cards?',
    'overdraft':           'how can i avoid overdraft fees?',
    # ── English: generic (short, match last) ───────────────────────────────
    'phone':               'update phone number',
    'balance':             'account balance',
    'credit card':         'credit card',
    'helpline':            'customer care number',
    'savings':             'savings account',
    'loan':                'loan',
    'kyc':                 'kyc update',
    'atm':                 'ஏடிஎம் எடுப்பு வரம்பு',
    'ifsc':                'ifsc code',
    'neft':                'neft timing',
    'rtgs':                'rtgs vs neft',
    'fraud':               'how can i protect my account from fraud?',
    # ── Tamil: specific (long) phrases ─────────────────────────────────────
    'கல்விக் கடன்':        'loan',
    'வீட்டுக் கடன்':       'வீட்டுக் கடன்',
    'தனிப்பட்ட கடன்':      'தனிப்பட்ட கடன்',
    'கடன் ஆவணங்கள்':       'கடன் ஆவணங்கள்',
    'கடன் வட்டி':          'கடன் வட்டி விகிதம்',
    'தொலைபேசி எண்':        'தொலைபேசி எண்ணைப் புதுப்பிக்க',
    'மொபைல் எண்':          'தொலைபேசி எண்ணைப் புதுப்பிக்க',
    'கணக்கு இருப்பு':      'கணக்கு இருப்பு',
    'கிரெடிட் கார்டு':     'கிரெடிட் கார்டு',
    'வாடிக்கையாளர் உதவி':  'வாடிக்கையாளர் உதவி எண்',
    'KYC புதுப்பிப்பு':    'KYC புதுப்பிப்பு',
    'ஏடிஎம் கார்டு':       'ஏடிஎம் கார்டு தடுக்கப்பட்டது',
    'நிலையான வைப்பு':      'நிலையான வைப்பு',
    'சேமிப்புக் கணக்கு':   'சேமிப்புக் கணக்கு',
    'மொபைல் பேங்கிங்':     'மொபைல் பேங்கிங்',
    'குறைந்தபட்ச இருப்பு': 'minimum balance',
    'வங்கி நேரம்':         'bank hours',
    # ── Tamil: generic (short, match last) ─────────────────────────────────
    'தொலைபேசி':            'தொலைபேசி எண்ணைப் புதுப்பிக்க',
    'புதுப்பிக்க':         'தொலைபேசி எண்ணைப் புதுப்பிக்க',
    'இருப்பு':             'கணக்கு இருப்பு',
    'கடன்':                'கடன்',
    'வாடிக்கையாளர்':       'வாடிக்கையாளர் உதவி எண்',
    'உதவி எண்':            'வாடிக்கையாளர் உதவி எண்',
    'KYC':                 'KYC புதுப்பிப்பு',
    'ஏடிஎம்':             'ஏடிஎம் எடுப்பு வரம்பு',
    'சேமிப்பு':            'சேமிப்புக் கணக்கு',
}


def get_bot_response(user_message: str, language: str = 'en') -> str:
    language = language if language in ('en', 'ta') else 'en'
    msg      = user_message.strip()
    msg_low  = msg.lower()

    # ── Greetings ──────────────────────────────────────────────────────────
    greetings_en = ['hi', 'hello', 'hey', 'greetings']
    greetings_ta = ['வணக்கம்', 'vanakkam', 'vanakam', 'வணக்கம்']

    if any(g in msg_low for g in greetings_en):
        if language == 'ta':
            return 'வணக்கம்! நான் உங்கள் வங்கி உதவியாளர். எவ்வாறு உதவலாம்?'
        return 'Hello! How can I assist you with your banking needs today?'

    if any(g in msg_low or g in msg for g in greetings_ta):
        return 'வணக்கம்! நான் உங்கள் வங்கி உதவியாளர். எவ்வாறு உதவலாம்?'

    # ── Thanks ─────────────────────────────────────────────────────────────
    thanks_en = ['thank you', 'thank', 'thanks']
    thanks_ta = ['நன்றி', 'nandri', 'தேங்க்ஸ்']

    if any(t in msg_low for t in thanks_en):
        if language == 'ta':
            return 'நன்றி! உங்களுக்கு நல்ல நாள் வாழ்த்துக்கள்.'
        return 'You are welcome! Have a great day.'

    if any(t in msg or t in msg_low for t in thanks_ta):
        return 'நன்றி! உங்களுக்கு நல்ல நாள் வாழ்த்துக்கள்.'

    # ── Bye ────────────────────────────────────────────────────────────────
    bye_en = ['bye', 'goodbye', 'bye bye']
    bye_ta = ['விடைபெறுகிறேன்', 'போய்வருகிறேன்', 'பிரியாவிடை', 'பை', 'piriyavida']

    if any(b in msg_low for b in bye_en):
        if language == 'ta':
            return 'விடைபெறுகிறேன்! மீண்டும் சந்திப்போம். நல்ல நாள்!'
        return 'Goodbye! Have a great day.'

    if any(b in msg or b in msg_low for b in bye_ta):
        return 'விடைபெறுகிறேன்! மீண்டும் சந்திப்போம். நல்ல நாள்!'

    # ── Database lookup ────────────────────────────────────────────────────
    conn = sqlite3.connect('database.db')
    c    = conn.cursor()

    # 1) Exact / partial LIKE match — works for both Tamil and English input
    c.execute(
        "SELECT answer FROM faq WHERE question LIKE ? OR question LIKE ? LIMIT 1",
        (f'%{msg}%', f'%{msg_low}%')
    )
    row = c.fetchone()
    if row:
        conn.close()
        return row[0]

    # 2) Keyword fallback — longest keyword first so "education loan" beats "loan"
    matched_key = None
    for keyword, faq_key in sorted(KEYWORD_MAP.items(), key=lambda x: -len(x[0])):
        if keyword in msg or keyword in msg_low:
            matched_key = faq_key
            break

    if matched_key:
        c.execute(
            "SELECT answer FROM faq WHERE question LIKE ? OR question LIKE ? LIMIT 1",
            (f'%{matched_key}%', f'%{matched_key.lower()}%')
        )
        row = c.fetchone()
        if row:
            conn.close()
            return row[0]

    conn.close()

    # ── Fallback ───────────────────────────────────────────────────────────
    if language == 'ta':
        return (
            'மன்னிக்கவும், எனக்கு புரியவில்லை.\n\n'
            'நீங்கள் கேட்கலாம்:\n'
            '• கணக்கு இருப்பு\n'
            '• கடன் விவரங்கள்\n'
            '• கிரெடிட் கார்டு\n'
            '• தொலைபேசி எண் புதுப்பித்தல்\n'
            '• வாடிக்கையாளர் உதவி\n\n'
            'உதவி எண்: 1800-419-2332 (24x7)'
        )
    return (
        'Sorry, I did not understand that.\n\n'
        'You can ask about:\n'
        '• Account Balance\n'
        '• Loan Details\n'
        '• Credit Cards\n'
        '• Phone Number Update\n'
        '• Customer Care\n\n'
        'Helpline: 1800-419-2332 (24x7)'
    )


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email    = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        if not username or not email or not password:
            return jsonify({'success': False, 'message': 'Please fill all fields'})
        if len(password) < 6:
            return jsonify({'success': False, 'message': 'Password must be at least 6 characters'})

        conn = sqlite3.connect('database.db')
        c    = conn.cursor()
        try:
            c.execute(
                "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
                (username, email, hash_password(password))
            )
            conn.commit()
            c.execute("SELECT id, username FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            conn.close()
            session['user_id']  = user[0]
            session['username'] = user[1]
            return jsonify({'success': True, 'message': 'Registration successful', 'redirect': '/'})
        except sqlite3.IntegrityError as e:
            conn.close()
            msg = 'Username already exists' if 'username' in str(e) else 'Email already registered'
            return jsonify({'success': False, 'message': msg})

    return render_template('login.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')

        if not username or not password:
            return jsonify({'success': False, 'message': 'Please enter username and password'})

        conn = sqlite3.connect('database.db')
        c    = conn.cursor()
        c.execute(
            "SELECT id, username FROM users WHERE (username=? OR email=?) AND password=?",
            (username, username, hash_password(password))
        )
        user = c.fetchone()
        conn.close()

        if user:
            session['user_id']  = user[0]
            session['username'] = user[1]
            return jsonify({'success': True, 'message': 'Login successful', 'redirect': '/'})
        return jsonify({'success': False, 'message': 'Invalid username or password'})

    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/api/chat', methods=['POST'])
def api_chat():
    language = 'en'          # default — must be declared before try for error handler
    try:
        data         = request.get_json(silent=True) or {}
        user_message = data.get('message', '').strip()
        language     = data.get('language', 'en')

        if not user_message:
            return jsonify({'response': '', 'timestamp': datetime.now().strftime('%H:%M')})

        bot_response = get_bot_response(user_message, language)

        user_id = session.get('user_id')
        if user_id:
            conn = sqlite3.connect('database.db')
            c    = conn.cursor()
            c.execute(
                "INSERT INTO chat_history (user_id, user_message, bot_response, language) VALUES (?,?,?,?)",
                (user_id, user_message, bot_response, language)
            )
            conn.commit()
            conn.close()

        return jsonify({'response': bot_response, 'timestamp': datetime.now().strftime('%H:%M')})

    except Exception as e:
        logger.error(f"Chat error: {e}")
        error_msg = (
            'மன்னிக்கவும், பிழை ஏற்பட்டது. தயவுசெய்து மீண்டும் முயற்சி செய்யவும்'
            if language == 'ta'
            else 'Sorry, an error occurred. Please try again.'
        )
        return jsonify({'response': error_msg}), 500


@app.route('/api/tts-ta', methods=['POST', 'OPTIONS'])
def tts_tamil():
    if request.method == 'OPTIONS':
        return '', 200

    try:
        data = request.get_json(silent=True) or {}
        text = data.get('text', '').strip()

        if not text:
            return jsonify({'error': 'No text provided'}), 400
        if len(text) > MAX_TTS_TEXT_LENGTH:
            return jsonify({'error': f'Text too long (max {MAX_TTS_TEXT_LENGTH} chars)'}), 400
        if not TTS_AVAILABLE:
            return jsonify({'error': 'TTS service unavailable'}), 503

        logger.info(f"Tamil TTS: {len(text)} chars")
        tts        = gTTS(text=text, lang='ta', slow=False)
        audio_data = io.BytesIO()
        tts.write_to_fp(audio_data)
        audio_data.seek(0)

        resp = Response(audio_data.read(), mimetype='audio/mpeg')
        resp.headers['Content-Disposition'] = 'inline; filename="speech.mp3"'
        resp.headers['Cache-Control']       = 'no-cache, no-store, must-revalidate'
        resp.headers['Pragma']              = 'no-cache'
        resp.headers['Expires']             = '0'
        return resp

    except Exception as e:
        logger.error(f"TTS error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/history', methods=['GET'])
def get_history():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify([])

    conn = sqlite3.connect('database.db')
    c    = conn.cursor()
    c.execute(
        "SELECT user_message, bot_response, created_at, language "
        "FROM chat_history WHERE user_id=? ORDER BY created_at ASC LIMIT 50",
        (user_id,)
    )
    rows = c.fetchall()
    conn.close()

    return jsonify([
        {'user_message': r[0], 'bot_response': r[1], 'created_at': r[2], 'language': r[3]}
        for r in rows
    ])


@app.route('/api/clear', methods=['POST'])
def clear_history():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'message': 'Not logged in'})

    conn = sqlite3.connect('database.db')
    c    = conn.cursor()
    c.execute("DELETE FROM chat_history WHERE user_id=?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    init_db()
    import_csv_to_db()

    # Create a test user if the users table is empty
    conn = sqlite3.connect('database.db')
    c    = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        c.execute(
            "INSERT INTO users (username, email, password) VALUES (?,?,?)",
            ('testuser', 'test@example.com', hash_password('test123'))
        )
        conn.commit()
        logger.info("Created test user: testuser / test123")
    conn.close()

    logger.info("Tamil TTS (gTTS) is ready" if TTS_AVAILABLE else "Tamil TTS NOT available")

    print("\n" + "=" * 50)
    print("Server: http://localhost:5000")
    print("Login:  testuser / test123")
    print("=" * 50 + "\n")

    app.run(debug=True, host='0.0.0.0', port=5000)
