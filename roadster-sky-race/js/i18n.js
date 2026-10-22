// 介面文字。zh-TW 維持原本用詞。其他語言要短，按鍵和 HUD 才放得下。
import { store } from './util.js';

export const LOCALES = ['zh-TW', 'en', 'fr', 'ja', 'ko'];

const ALIAS = {
  zh: 'zh-TW', 'zh-tw': 'zh-TW', 'zh-hant': 'zh-TW', 'zh-hant-tw': 'zh-TW', 'zh-hk': 'zh-TW', 'zh-mo': 'zh-TW',
  'zh-cn': 'zh-TW', 'zh-hans': 'zh-TW', 'zh-sg': 'zh-TW',
  en: 'en', 'en-us': 'en', 'en-gb': 'en', 'en-au': 'en',
  fr: 'fr', 'fr-fr': 'fr', 'fr-ca': 'fr', 'fr-be': 'fr', 'fr-ch': 'fr',
  ja: 'ja', 'ja-jp': 'ja',
  ko: 'ko', 'ko-kr': 'ko',
};

const ROWS = [
  ['app.title', '天空飛馳 Sky Roadster', 'Sky Roadster', 'Sky Roadster', 'スカイロードスター', '스카이 로드스터'],
  ['title.main', '天空飛馳', 'Sky Roadster', 'Sky Roadster', 'スカイロードスター', '스카이 로드스터'],
  ['title.sub', 'Sky Roadster', 'Sky Roadster', 'Sky Roadster', 'Sky Roadster', 'Sky Roadster'],
  ['tagline', '致敬未來跑車的粉絲作品・會飛的賽車', 'A fan-made flying racer, inspired by tomorrow’s car.', 'Course volante, hommage amateur à la voiture de demain.', '未来のスポーツカーへのファン作品。空を飛ぶレース。', '미래의 스포츠카를 향한 팬 작품. 하늘을 나는 레이스.'],
  ['notice.title', '僅限停車（P 檔）時遊玩', 'Play only while parked (P)', 'Jouer uniquement à l’arrêt (P)', '駐車（P）中だけ遊べます', '주차(P) 중에만 플레이'],
  ['notice.body', 'Tesla 車機瀏覽器只允許在停妥時使用網頁遊戲。行駛中請勿操作，確保安全。', 'The Tesla browser only allows web games while parked. Do not play while driving.', 'Le navigateur Tesla n’autorise les jeux web qu’à l’arrêt. Ne jouez pas en conduisant.', 'Tesla のブラウザは停車中だけウェブゲームを許可します。走行中は操作しないでください。', 'Tesla 브라우저는 정차 중에만 웹 게임을 허용합니다. 주행 중에는 조작하지 마세요.'],

  ['start.car', '目前車輛：{name}（{tag}）・{paint}', 'Car: {name} ({tag}) · {paint}', 'Voiture : {name} ({tag}) · {paint}', '車両：{name}（{tag}）・{paint}', '차량: {name} ({tag}) · {paint}'],
  ['start.carEmpty', '目前車輛：—', 'Car: —', 'Voiture : —', '車両：—', '차량: —'],
  ['start.track', '目前賽道：{name}（{tag}）', 'Track: {name} ({tag})', 'Circuit : {name} ({tag})', 'コース：{name}（{tag}）', '트랙: {name} ({tag})'],
  ['start.trackEmpty', '目前賽道：—', 'Track: —', 'Circuit : —', 'コース：—', '트랙: —'],
  ['start.pad.wait', '🎮 尚未偵測到搖桿：請接上 JOWUA 搖桿並按任一鍵', '🎮 No gamepad yet. Plug in the JOWUA pad and press any button.', '🎮 Aucune manette. Branchez la JOWUA et appuyez sur une touche.', '🎮 パッド未検出。JOWUA を接続して何か押してください。', '🎮 패드 없음. JOWUA를 연결하고 아무 버튼이나 누르세요.'],
  ['start.pad.on', '🎮 已連接：{name}（{profile}）', '🎮 Connected: {name} ({profile})', '🎮 Connectée : {name} ({profile})', '🎮 接続中：{name}（{profile}）', '🎮 연결됨: {name} ({profile})'],
  ['start.p1.pad', 'P1：手把 {index}　{name}', 'P1: pad {index}  {name}', 'P1 : manette {index}  {name}', 'P1：パッド {index}　{name}', 'P1: 패드 {index}  {name}'],
  ['start.p1.keys', 'P1：鍵盤、觸控（沒有第二支手把時也是你）', 'P1: keyboard and touch (you, until a second pad joins)', 'P1 : clavier et tactile (vous, tant qu’il n’y a pas de 2e manette)', 'P1：キーボード、タッチ（2台目が入るまではあなた）', 'P1: 키보드, 터치 (두 번째 패드 전까지 당신)'],
  ['start.p1.short', 'P1：鍵盤、觸控，或第一支手把', 'P1: keyboard, touch, or the first pad', 'P1 : clavier, tactile, ou la première manette', 'P1：キーボード、タッチ、または最初のパッド', 'P1: 키보드, 터치, 또는 첫 패드'],
  ['start.p2.hint', '第二支搖桿：按任一鍵加入 P2', 'Second pad: press any button to join as P2', '2e manette : une touche pour rejoindre en P2', '2台目：何か押すと P2 で参加', '두 번째 패드: 아무 버튼이나 눌러 P2 참가'],
  ['start.p2.on', 'P2：手把 {index}　{name}（上下分屏）。按 Back／Select／－ 離開。', 'P2: pad {index}  {name} (split screen). Back / Select / − to leave.', 'P2 : manette {index}  {name} (écran partagé). Back / Select / − pour quitter.', 'P2：パッド {index}　{name}（上下分割）。Back／Select／− で退出。', 'P2: 패드 {index}  {name} (화면 분할). Back / Select / − 로 나가기.'],
  ['start.p2.off', 'P2：用另一支手把按任意鍵加入，上下分屏。鍵盤與觸控在沒有第二支手把時都是 P1。', 'P2: press any button on another pad for split screen. Keyboard and touch stay P1 until then.', 'P2 : une touche sur une autre manette pour partager l’écran. Clavier et tactile restent P1.', 'P2：別のパッドの何かで参加、上下分割。2台目がないときキーボードとタッチは P1。', 'P2: 다른 패드의 아무 버튼으로 참가, 화면 분할. 없으면 키보드와 터치는 P1.'],
  ['start.phone', 'P3：用手機掃碼加入，在自己的螢幕開車', 'P3: scan with a phone and drive on its own screen', 'P3 : scannez avec un téléphone et conduisez sur son écran', 'P3：スマホで読み取り、その画面で運転', 'P3: 휴대폰으로 스캔하고 그 화면에서 운전'],
  ['start.phoneHint', '車機畫面仍是一人或上下兩人。第三人用手機加入同一場。連不上時，這台比賽照常進行。', 'The car screen stays one or two players. A third joins on a phone. If it fails, this race continues.', 'L’écran de la voiture reste à un ou deux joueurs. Un troisième rejoint sur téléphone. Sans connexion, la course continue.', '車の画面は1人か上下2人のまま。3人目はスマホで同じレースに参加。繋がらなくてもレースは続きます。', '차량 화면은 1인 또는 상하 2인. 세 번째는 휴대폰으로 같은 경기에 참가. 연결이 안 돼도 경기는 계속됩니다.'],
  ['start.ai', '電腦對手', 'AI racers', 'Adversaires', 'COM', '컴퓨터'],
  ['start.diff', '對手難度', 'AI level', 'Niveau', 'COM の強さ', '난이도'],
  ['diff.easy', '簡單', 'Easy', 'Facile', '易しい', '쉬움'],
  ['diff.normal', '普通', 'Normal', 'Normal', '普通', '보통'],
  ['diff.hard', '困難', 'Hard', 'Difficile', '難しい', '어려움'],
  ['start.note', '車機上最多兩人、畫面上下各一半。第三人用手機掃碼，在自己的螢幕開同一場。沒有第二支手把時，鍵盤和觸控都是 P1。電腦對手可以一起跑。', 'Up to two players on the car screen, split top and bottom. A third scans in and races on their phone. With one pad, keyboard and touch are P1. AI can race along.', 'Deux joueurs au maximum sur l’écran de la voiture, en haut et en bas. Un troisième scanne et joue sur son téléphone. Sans 2e manette, clavier et tactile sont P1. Les COM peuvent courir aussi.', '車の画面は最大2人、上下半分ずつ。3人目はスマホで同じレース。パッドが1台ならキーボードとタッチは P1。COM も一緒に走れます。', '차량 화면은 최대 2인, 위아래 절반. 세 번째는 휴대폰으로 같은 경기. 패드가 하나면 키보드와 터치는 P1. 컴퓨터도 함께 달립니다.'],
  ['menu.start', '開始遊戲', 'Start', 'Jouer', 'スタート', '시작'],
  ['menu.tracks', '選擇賽道', 'Tracks', 'Circuits', 'コース', '트랙'],
  ['menu.garage', '選擇車輛', 'Garage', 'Garage', 'ガレージ', '차고'],
  ['menu.mapping', '按鍵設定', 'Controls', 'Commandes', '操作設定', '조작'],
  ['menu.settings', '畫質與設定', 'Graphics', 'Graphismes', '画質と設定', '그래픽'],
  ['menu.full', '全螢幕', 'Full screen', 'Plein écran', '全画面', '전체 화면'],
  ['menu.padtest', '搖桿測試頁', 'Gamepad test', 'Test manette', 'パッドテスト', '패드 테스트'],
  ['menu.lang', '語言', 'Language', 'Langue', '言語', '언어'],
  ['flow.start', '開始', 'Start', 'Jouer', 'スタート', '시작'],
  ['flow.next', '下一步', 'Next', 'Suite', '次へ', '다음'],
  ['flow.back', '返回', 'Back', 'Retour', '戻る', '뒤로'],
  ['mode.title', '選擇模式', 'Mode', 'Mode', 'モード', '모드'],
  ['mode.solo', '單人', 'Solo', 'Solo', 'ソロ', '솔로'],
  ['mode.multi', '多人', 'Multi', 'Multi', 'マルチ', '멀티'],
  ['mode.hint', '單人直接選車。多人可以接手把，或用手機掃碼加入。', 'Solo goes straight to the car. Multi adds a pad or a phone.', 'Solo passe à la voiture. Multi ajoute une manette ou un téléphone.', 'ソロはすぐ車選び。マルチはパッドかスマホ。', '솔로는 바로 차 선택. 멀티는 패드나 휴대폰.'],
  ['lobby.title', '一起開', 'Players', 'Joueurs', 'プレイヤー', '플레이어'],
  ['lobby.next', '繼續', 'Continue', 'Continuer', '続ける', '계속'],
  ['lobby.hint', '第二支手把按任意鍵加入。手機掃右側 QR。準備好就繼續。', 'Press any button on a second pad. Scan the QR with a phone. Continue when ready.', 'Une touche sur la 2e manette. Scannez le QR. Continuez quand vous voulez.', '2台目は何か押す。スマホでQR。準備できたら続ける。', '두 번째 패드는 아무 버튼. 휴대폰으로 QR. 준비되면 계속.'],
  ['ready.title', '準備出發', 'Ready', 'Prêt', '出発', '출발'],
  ['ready.go', '開跑', 'Race', 'Lancer', 'スタート', '출발'],
  ['ready.mode.solo', '單人', 'Solo', 'Solo', 'ソロ', '솔로'],
  ['ready.mode.multi', '多人', 'Multi', 'Multi', 'マルチ', '멀티'],
  ['ready.ai', '電腦對手 {n} · {diff}', 'AI {n} · {diff}', 'COM {n} · {diff}', 'COM {n} · {diff}', '컴퓨터 {n} · {diff}'],
  ['ready.aiNone', '沒有電腦對手', 'No AI', 'Sans COM', 'COM なし', '컴퓨터 없음'],
  ['set.extra', '其他', 'More', 'Plus', 'その他', '기타'],

  ['legend.stick', '左搖桿', 'Left stick', 'Stick gauche', '左スティック', '왼쪽 스틱'],
  ['legend.steer', '轉向', 'Steer', 'Direction', 'ステア', '조향'],
  ['legend.gas', '加速', 'Accelerate', 'Accélérer', '加速', '가속'],
  ['legend.brake', '煞車／倒車', 'Brake / reverse', 'Frein / recul', 'ブレーキ／後退', '브레이크 / 후진'],
  ['legend.lift', '起飛推進器', 'Lifter', 'Propulseur', '浮上', '부상'],
  ['legend.nitro', '氮氣', 'Nitro', 'Nitro', 'ニトロ', '니트로'],
  ['legend.cam', '切換視角', 'Camera', 'Caméra', '視点', '시점'],
  ['legend.reset', '回到賽道', 'Back on track', 'Retour piste', 'コース復帰', '트랙 복귀'],
  ['legend.pause', '暫停', 'Pause', 'Pause', '一時停止', '일시정지'],
  ['legend.pitch', '左搖桿上下', 'Left stick up/down', 'Stick haut/bas', '左スティック上下', '왼쪽 스틱 상하'],
  ['legend.pitchDo', '空中升降', 'Pitch in the air', 'Tangage en vol', '空中の上下', '공중 상하'],
  ['pad.profile.on', '搖桿設定檔：{name}（{mode}；確認＝{ok}、返回＝{back}）', 'Pad profile: {name} ({mode}; confirm = {ok}, back = {back})', 'Profil : {name} ({mode} ; valider = {ok}, retour = {back})', 'パッド：{name}（{mode}；決定＝{ok}、戻る＝{back}）', '패드: {name} ({mode}; 확인 = {ok}, 뒤로 = {back})'],
  ['pad.profile.off', '未偵測到搖桿：以 {name} 標示顯示。', 'No pad detected. Labels use {name}.', 'Aucune manette. Libellés : {name}.', 'パッドなし。表示は {name}。', '패드 없음. 표시는 {name}.'],
  ['pad.mode.auto', '自動偵測', 'Auto', 'Auto', '自動', '자동'],
  ['pad.mode.switch', '手動：Switch 模式', 'Manual: Switch', 'Manuel : Switch', '手動：Switch', '수동: Switch'],
  ['pad.mode.xbox', '手動：X-input 模式', 'Manual: X-input', 'Manuel : X-input', '手動：X-input', '수동: X-input'],
  ['pad.generic', '一般搖桿', 'Generic pad', 'Manette générique', '一般パッド', '일반 패드'],
  ['pad.up', '十字上', 'D-pad up', 'Croix haut', '十字上', '십자 위'],
  ['pad.down', '十字下', 'D-pad down', 'Croix bas', '十字下', '십자 아래'],
  ['pad.left', '十字左', 'D-pad left', 'Croix gauche', '十字左', '십자 왼쪽'],
  ['pad.right', '十字右', 'D-pad right', 'Croix droite', '十字右', '십자 오른쪽'],
  ['pad.capture', '截圖', 'Capture', 'Capture', 'キャプチャ', '캡처'],
  ['hint.bar', '{thr} 加速　{brk} 煞車　{lift} 起飛推進　{nitro} 氮氣　{cam} 視角　{reset} 回賽道　{pause} 暫停', '{thr} gas  {brk} brake  {lift} lift  {nitro} nitro  {cam} view  {reset} reset  {pause} pause', '{thr} gaz  {brk} frein  {lift} vol  {nitro} nitro  {cam} vue  {reset} piste  {pause} pause', '{thr} 加速　{brk} ブレーキ　{lift} 浮上　{nitro} ニトロ　{cam} 視点　{reset} 復帰　{pause} 停止', '{thr} 가속  {brk} 브레이크  {lift} 부상  {nitro} 니트로  {cam} 시점  {reset} 복귀  {pause} 정지'],

  ['tracks.title', '選擇賽道', 'Tracks', 'Circuits', 'コース', '트랙'],
  ['tracks.best', '最佳單圈：{time}', 'Best lap: {time}', 'Meilleur tour : {time}', 'ベストラップ：{time}', '베스트 랩: {time}'],
  ['tracks.bestNone', '最佳單圈：—', 'Best lap: —', 'Meilleur tour : —', 'ベストラップ：—', '베스트 랩: —'],
  ['tracks.done', '完成', 'Done', 'OK', '完了', '완료'],
  ['tracks.hint', '搖桿／鍵盤可導覽。選擇會自動儲存；切換賽道會重新載入場景。', 'Pad or keyboard to move. The choice is saved. Switching tracks reloads the scene.', 'Manette ou clavier pour naviguer. Le choix est enregistré. Changer de circuit recharge la scène.', 'パッド／キーボードで移動。選択は保存されます。コースを変えると再読み込みします。', '패드나 키보드로 이동. 선택은 저장됩니다. 트랙을 바꾸면 장면을 다시 불러옵니다.'],
  ['garage.title', '選擇車輛', 'Garage', 'Garage', 'ガレージ', '차고'],
  ['garage.paint', '車色', 'Paint', 'Peinture', 'カラー', '도색'],
  ['garage.mass', '{tag}・約 {n} 噸', '{tag} · about {n} t', '{tag} · env. {n} t', '{tag}・約 {n} t', '{tag} · 약 {n} t'],
  ['garage.hint', '搖桿：十字鍵／左搖桿選擇，確認鍵選取，返回鍵離開。選擇會自動儲存。所有車型皆為原創造型，沒有任何商標或標誌。', 'Pad: D-pad or left stick to move, confirm to pick, back to leave. Saved automatically. Every car is an original shape, with no logos.', 'Manette : croix ou stick pour bouger, valider pour choisir, retour pour quitter. Enregistré. Chaque voiture est une forme originale, sans logo.', 'パッド：十字／左スティックで選択、決定で確定、戻るで終了。自動保存。車はすべてオリジナル形状で、ロゴはありません。', '패드: 십자키나 왼쪽 스틱으로 이동, 확인으로 선택, 뒤로 종료. 자동 저장. 모든 차는 로고 없는 원래 형태입니다.'],
  ['garage.back', '完成', 'Done', 'OK', '完了', '완료'],

  ['results.title', '名次', 'Results', 'Résultats', '順位', '순위'],
  ['results.sub', '兩圈衝刺', 'Two-lap sprint', 'Sprint de deux tours', '2周スプリント', '2랩 스프린트'],
  ['results.dnf', '未完成', 'DNF', 'Abandon', '未完走', '미완주'],
  ['results.again', '再比一場', 'Race again', 'Rejouer', 'もう一度', '다시 달리기'],
  ['results.quit', '回主選單', 'Main menu', 'Menu', 'メニュー', '메뉴'],

  ['join.title', '加入比賽', 'Join race', 'Rejoindre', 'レースに参加', '경기 참가'],
  ['join.wait', '正在連線…', 'Connecting…', 'Connexion…', '接続中…', '연결 중…'],
  ['join.carWait', '這台車：等待房主指定…', 'Car: waiting for the host…', 'Voiture : en attente de l’hôte…', '車両：ホストの指定待ち…', '차량: 호스트 지정 대기…'],
  ['join.car', '這台車：{name}・{paint}', 'Car: {name} · {paint}', 'Voiture : {name} · {paint}', '車両：{name}・{paint}', '차량: {name} · {paint}'],
  ['join.help', '你是 P3。畫面固定橫向，按鍵比照手把：左邊轉向，LT 煞車、RT 加速，右邊是 A／B／X／Y。車機上看到的也是這台車。', 'You are P3. The view stays landscape. Left stick steers, LT brakes, RT accelerates, and A/B/X/Y sit on the right. The car screen shows this same car.', 'Vous êtes P3. L’image reste en paysage. Le stick gauche tourne, LT freine, RT accélère, A/B/X/Y à droite. La voiture à l’écran de l’hôte est la même.', 'あなたは P3。画面は横固定。左でステア、LT ブレーキ、RT 加速、右は A／B／X／Y。車の画面にも同じ車が出ます。', '당신은 P3. 화면은 가로 고정. 왼쪽 조향, LT 브레이크, RT 가속, 오른쪽은 A/B/X/Y. 차량 화면에도 같은 차가 보입니다.'],
  ['join.garage', '換一台車', 'Change car', 'Changer', '車を変える', '차 바꾸기'],
  ['join.retry', '重新連線', 'Reconnect', 'Reconnecter', '再接続', '다시 연결'],
  ['join.leave', '離開，自己開一場', 'Leave and race alone', 'Quitter et jouer seul', '出て一人で走る', '나가고 혼자 달리기'],

  ['pause.title', '暫停', 'Paused', 'Pause', '一時停止', '일시정지'],
  ['pause.resume', '繼續', 'Resume', 'Reprendre', '続ける', '계속'],
  ['pause.restart', '重新開始', 'Restart', 'Recommencer', 'やり直す', '다시 시작'],
  ['pause.garage', '換一台車', 'Change car', 'Changer de voiture', '車を変える', '차 바꾸기'],
  ['pause.quit', '回主選單', 'Main menu', 'Menu principal', 'メニューへ', '메인 메뉴'],

  ['set.title', '畫質與設定', 'Graphics and settings', 'Graphismes et options', '画質と設定', '그래픽과 설정'],
  ['set.quality', '畫質（切換會重新載入）', 'Quality (reloads)', 'Qualité (recharge)', '画質（切り替えると再読み込み）', '화질 (바꾸면 다시 불러옴)'],
  ['q.low', '低', 'Low', 'Basse', '低', '낮음'],
  ['q.med', '中', 'Med', 'Moy.', '中', '중간'],
  ['q.high', '高', 'High', 'Haute', '高', '높음'],
  ['set.vol', '音量', 'Volume', 'Volume', '音量', '음량'],
  ['vol.0', '靜音', 'Mute', 'Muet', '消音', '음소거'],
  ['vol.low', '小', 'Low', 'Bas', '小', '작게'],
  ['vol.med', '中', 'Med', 'Moyen', '中', '중간'],
  ['vol.high', '大', 'High', 'Fort', '大', '크게'],
  ['set.pad', '搖桿模式', 'Pad mode', 'Mode manette', 'パッドモード', '패드 모드'],
  ['set.padHint', '（JOWUA：S 模式選 Switch，X 模式選 X-input；自動偵測會依裝置名稱判斷）', '(JOWUA: S mode = Switch, X mode = X-input. Auto uses the device name.)', '(JOWUA : mode S = Switch, mode X = X-input. Auto lit le nom.)', '（JOWUA：S は Switch、X は X-input。自動は装置名で判断）', '(JOWUA: S는 Switch, X는 X-input. 자동은 장치 이름)'],
  ['set.pad.auto', '自動偵測', 'Auto', 'Auto', '自動', '자동'],
  ['set.pad.switch', 'Switch 模式', 'Switch', 'Switch', 'Switch', 'Switch'],
  ['set.pad.xbox', 'X-input（Xbox）模式', 'X-input (Xbox)', 'X-input (Xbox)', 'X-input（Xbox）', 'X-input (Xbox)'],
  ['set.invert', '轉向左右反轉', 'Invert steering', 'Inverser la direction', 'ステア左右反転', '조향 좌우 반전'],
  ['set.invertHint', '（所有輸入：搖桿、十字鍵、鍵盤、觸控）', '(pad, D-pad, keyboard, and touch)', '(manette, croix, clavier et tactile)', '（パッド、十字、キーボード、タッチ）', '(패드, 십자키, 키보드, 터치)'],
  ['set.on', '開', 'On', 'Oui', 'オン', '켬'],
  ['set.off', '關', 'Off', 'Non', 'オフ', '끔'],
  ['set.rumble', '搖桿震動', 'Rumble', 'Vibration', '振動', '진동'],
  ['set.touch', '觸控按鍵', 'Touch buttons', 'Touches tactiles', 'タッチボタン', '터치 버튼'],
  ['touch.auto', '自動', 'Auto', 'Auto', '自動', '자동'],
  ['touch.show', '顯示', 'Show', 'Afficher', '表示', '표시'],
  ['touch.hide', '隱藏', 'Hide', 'Masquer', '隠す', '숨김'],
  ['set.back', '返回', 'Back', 'Retour', '戻る', '뒤로'],
  ['set.qinfo', '低：不使用陰影、解析度 62%，適合效能較弱的車機；中：預設；高：2048 陰影、完整解析度。', 'Low: no shadows, 62% resolution, for a slower car browser. Medium: default. High: 2048 shadows, full resolution.', 'Basse : pas d’ombres, résolution 62 %. Moyenne : défaut. Haute : ombres 2048, pleine résolution.', '低：影なし、解像度 62%。中：標準。高：影 2048、フル解像度。', '낮음: 그림자 없음, 해상도 62%. 중간: 기본. 높음: 그림자 2048, 전체 해상도.'],

  ['map.title', '按鍵設定', 'Controls', 'Commandes', '操作設定', '조작 설정'],
  ['map.cal', '校正搖桿', 'Calibrate', 'Calibrer', '補正', '보정'],
  ['map.reset', '重設為標準', 'Reset', 'Réinit.', '標準に戻す', '기본값'],
  ['map.modeHint', '（強制覆寫自動偵測）', '(overrides auto)', '(force le mode)', '（自動検出を上書き）', '(자동을 덮어씀)'],
  ['map.none', '未偵測到搖桿', 'No gamepad detected', 'Aucune manette', 'パッド未検出', '패드 없음'],
  ['map.connected', '已連接：{id}（映射：{mapping}；使用「{profile}」設定檔，{mode}）', 'Connected: {id} (mapping: {mapping}; profile “{profile}”, {mode})', 'Connectée : {id} (mappage : {mapping} ; profil « {profile} », {mode})', '接続中：{id}（マッピング：{mapping}；プロファイル「{profile}」、{mode}）', '연결됨: {id} (매핑: {mapping}; 프로필 “{profile}”, {mode})'],
  ['map.raw', '非標準（原始）', 'nonstandard (raw)', 'non standard (brut)', '非標準（生）', '비표준 (원시)'],
  ['map.modeAuto', '自動偵測', 'auto', 'auto', '自動', '자동'],
  ['map.modeManual', '手動指定', 'manual', 'manuel', '手動', '수동'],
  ['map.calibrating', '校正中…請放開搖桿，不要碰任何方向。', 'Calibrating… release the sticks and don’t touch a direction.', 'Calibration… lâchez les sticks, ne touchez aucune direction.', '補正中…スティックを離し、方向を押さないでください。', '보정 중… 스틱을 놓고 방향을 누르지 마세요.'],
  ['map.calDone', '搖桿中心已校正{hat}。若搖桿自己漂移，按「校正搖桿」。', 'Stick center saved{hat}. If it drifts, press Calibrate.', 'Centre enregistré{hat}. S’il dérive, appuyez sur Calibrer.', '中心を補正しました{hat}。勝手に動くときは「補正」。', '스틱 중심을 저장했습니다{hat}. 저절로 움직이면 보정을 누르세요.'],
  ['map.hat', '（已忽略十字鍵 hat 軸 {axes}）', ' (ignored D-pad hat axes {axes})', ' (axes hat ignorés : {axes})', '（十字 hat 軸 {axes} を無視）', ' (십자 hat 축 {axes} 무시)'],
  ['map.help', '點選一個動作後，依提示操作搖桿即可重新指定；有改動會自動儲存在這台車機的瀏覽器。右側橫條會即時顯示輸入，方便確認。', 'Pick an action, then follow the prompt. Changes stay in this browser. The bars on the right show live input.', 'Choisissez une action, puis suivez l’invite. Les changements restent dans ce navigateur. Les barres à droite montrent l’entrée.', '動作を選んで案内どおり操作します。変更はこのブラウザに保存されます。右のバーが入力です。', '동작을 고른 뒤 안내를 따르세요. 변경은 이 브라우저에 저장됩니다. 오른쪽 막대가 입력입니다.'],
  ['map.noPad', '尚未偵測到搖桿', 'No gamepad yet', 'Pas encore de manette', 'まだパッドがありません', '아직 패드가 없습니다'],
  ['map.noPadSub', '請先接上搖桿並按任一鍵，再重試。', 'Plug in a pad, press any button, then try again.', 'Branchez une manette, appuyez, puis réessayez.', 'パッドを接続して何か押してから、もう一度。', '패드를 연결하고 버튼을 누른 뒤 다시 하세요.'],
  ['map.cancel', '取消', 'Cancel', 'Annuler', 'キャンセル', '취소'],
  ['map.timeout', '（5 秒內未操作會取消）', ' (cancels after 5 seconds)', ' (annulé après 5 s)', '（5秒でキャンセル）', ' (5초 후 취소)'],
  ['map.needPad', '未偵測到搖桿：請接上搖桿並按任一鍵', 'No pad. Plug one in and press any button.', 'Pas de manette. Branchez-la et appuyez.', 'パッドなし。接続して何か押してください。', '패드 없음. 연결하고 아무 버튼이나 누르세요.'],

  ['act.steer', '轉向（左搖桿左右）', 'Steer (left stick left/right)', 'Direction (stick gauche)', 'ステア（左スティック左右）', '조향 (왼쪽 스틱 좌우)'],
  ['act.pitch', '空中升降（左搖桿上下）', 'Pitch (left stick up/down)', 'Tangage (stick haut/bas)', '空中上下（左スティック上下）', '공중 상하 (왼쪽 스틱)'],
  ['act.throttle', '加速（{key}）', 'Accelerate ({key})', 'Accélérer ({key})', '加速（{key}）', '가속 ({key})'],
  ['act.brake', '煞車 / 倒車（{key}）', 'Brake / reverse ({key})', 'Frein / recul ({key})', 'ブレーキ／後退（{key}）', '브레이크 / 후진 ({key})'],
  ['act.lift', '起飛推進器（{key}）', 'Lifter ({key})', 'Propulseur ({key})', '浮上（{key}）', '부상 ({key})'],
  ['act.nitro', '氮氣加速（{key}）', 'Nitro ({key})', 'Nitro ({key})', 'ニトロ（{key}）', '니트로 ({key})'],
  ['act.camera', '切換視角（{key}）', 'Camera ({key})', 'Caméra ({key})', '視点（{key}）', '시점 ({key})'],
  ['act.reset', '回到賽道（{key}）', 'Back on track ({key})', 'Retour piste ({key})', 'コース復帰（{key}）', '트랙 복귀 ({key})'],
  ['act.pause', '暫停選單（{key}）', 'Pause ({key})', 'Pause ({key})', '一時停止（{key}）', '일시정지 ({key})'],
  ['act.steerHint', '請把搖桿「往右」推到底', 'Push the stick all the way right', 'Poussez le stick à fond à droite', 'スティックを右いっぱいに倒してください', '스틱을 오른쪽 끝까지 미세요'],
  ['act.pitchHint', '請把搖桿「往上」推到底', 'Push the stick all the way up', 'Poussez le stick à fond vers le haut', 'スティックを上いっぱいに倒してください', '스틱을 위쪽 끝까지 미세요'],
  ['act.throttleHint', '請按住要用來加速的鍵或板機', 'Hold the button or trigger you want for gas', 'Maintenez la touche ou la gâchette d’accélération', '加速に使うボタンかトリガーを押し続けてください', '가속에 쓸 버튼이나 트리거를 누르고 있으세요'],
  ['act.brakeHint', '請按住要用來煞車的鍵或板機', 'Hold the button or trigger you want for brake', 'Maintenez la touche ou la gâchette de frein', 'ブレーキに使うボタンかトリガーを押し続けてください', '브레이크에 쓸 버튼이나 트리거를 누르고 있으세요'],
  ['act.liftHint', '請按下要用來起飛的按鈕', 'Press the button you want for lift', 'Appuyez sur le bouton de décollage', '浮上に使うボタンを押してください', '부상에 쓸 버튼을 누르세요'],
  ['act.nitroHint', '請按下要用來氮氣的按鈕', 'Press the button you want for nitro', 'Appuyez sur le bouton de nitro', 'ニトロに使うボタンを押してください', '니트로에 쓸 버튼을 누르세요'],
  ['act.cameraHint', '請按下要用來切換視角的按鈕', 'Press the button you want for the camera', 'Appuyez sur le bouton de caméra', '視点に使うボタンを押してください', '시점에 쓸 버튼을 누르세요'],
  ['act.resetHint', '請按下要用來回到賽道的按鈕', 'Press the button you want to return to the track', 'Appuyez sur le bouton de retour en piste', 'コース復帰に使うボタンを押してください', '트랙 복귀에 쓸 버튼을 누르세요'],
  ['act.pauseHint', '請按下要用來暫停的按鈕', 'Press the button you want for pause', 'Appuyez sur le bouton de pause', '一時停止に使うボタンを押してください', '일시정지에 쓸 버튼을 누르세요'],
  ['bind.none', '未設定', 'Not set', 'Non défini', '未設定', '없음'],
  ['bind.btn', '按鈕 {i}', 'Button {i}', 'Bouton {i}', 'ボタン {i}', '버튼 {i}'],
  ['bind.btnNamed', '按鈕 {i}（{name}）', 'Button {i} ({name})', 'Bouton {i} ({name})', 'ボタン {i}（{name}）', '버튼 {i} ({name})'],
  ['bind.axis', '軸 {i}（{mode}{inv}）', 'Axis {i} ({mode}{inv})', 'Axe {i} ({mode}{inv})', '軸 {i}（{mode}{inv}）', '축 {i} ({mode}{inv})'],
  ['bind.full', '全幅', 'full', 'complet', '全幅', '전체'],
  ['bind.pos', '正向', 'positive', 'positif', '正方向', '양'],
  ['bind.neg', '負向', 'negative', 'négatif', '負方向', '음'],
  ['bind.trig', '板機', 'trigger', 'gâchette', 'トリガー', '트리거'],
  ['bind.inv', '・反向', ' · inverted', ' · inversé', '・反転', ' · 반전'],

  ['touch.gas', '加速', 'GAS', 'GAZ', '加速', '가속'],
  ['touch.brake', '煞車', 'BRAKE', 'FREIN', '制動', '제동'],
  ['touch.steer', '轉向', 'STEER', 'DIR.', '操舵', '조향'],
  ['touch.cam', '視角', 'VIEW', 'VUE', '視点', '시점'],
  ['touch.reset', '回賽道', 'RESET', 'PISTE', '復帰', '복귀'],
  ['touch.lift', '推進', 'LIFT', 'VOL', '浮上', '부상'],
  ['touch.nitro', '氮氣', 'NITRO', 'NITRO', 'ニトロ', '니트로'],
  ['touch.pause', '暫停', 'PAUSE', 'PAUSE', '停止', '정지'],
  ['touch.gasAria', '加速', 'Accelerate', 'Accélérer', '加速', '가속'],
  ['touch.brakeAria', '煞車', 'Brake', 'Freiner', 'ブレーキ', '브레이크'],
  ['touch.steerAria', '左搖桿 轉向', 'Left stick, steer', 'Stick gauche, direction', '左スティック ステア', '왼쪽 스틱 조향'],
  ['touch.camAria', 'Y 視角', 'Y view', 'Y vue', 'Y 視点', 'Y 시점'],
  ['touch.resetAria', 'X 回賽道', 'X reset', 'X piste', 'X 復帰', 'X 복귀'],
  ['touch.liftAria', 'B 推進', 'B lift', 'B vol', 'B 浮上', 'B 부상'],
  ['touch.nitroAria', 'A 氮氣', 'A nitro', 'A nitro', 'A ニトロ', 'A 니트로'],
  ['touch.pauseAria', '暫停', 'Pause', 'Pause', '一時停止', '일시정지'],

  ['hud.lap', '圈數', 'Lap', 'Tour', '周回', '랩'],
  ['hud.this', '本圈', 'This lap', 'Ce tour', '今の周', '이번 랩'],
  ['hud.last', '上一圈', 'Last', 'Dernier', '前の周', '이전 랩'],
  ['hud.best', '最佳', 'Best', 'Record', 'ベスト', '베스트'],
  ['hud.full', '⛶ 全螢幕', '⛶ Full', '⛶ Écran', '⛶ 全画面', '⛶ 전체'],
  ['hud.fullTitle', '全螢幕', 'Full screen', 'Plein écran', '全画面', '전체 화면'],
  ['hud.padNone', '🎮 未偵測到搖桿', '🎮 No gamepad', '🎮 Pas de manette', '🎮 パッドなし', '🎮 패드 없음'],
  ['hud.cam', '視角：{name}', 'View: {name}', 'Vue : {name}', '視点：{name}', '시점: {name}'],
  ['hud.energy', '推進能量 {n}%', 'Lift energy {n}%', 'Énergie {n}%', '浮上エネルギー {n}%', '부상 에너지 {n}%'],
  ['hud.nitro', '氮氣加速', 'Nitro', 'Nitro', 'ニトロ', '니트로'],
  ['hud.flying', '推進飛行', 'Lifting', 'En vol', '浮上中', '부상 중'],
  ['hud.air', '滯空', 'Airborne', 'En l’air', '滞空', '공중'],
  ['hud.off', '離開路面', 'Off road', 'Hors piste', '路面外', '도로 밖'],
  ['hud.ground', '地面行駛', 'On the road', 'Sur la piste', '路面走行', '노면 주행'],
  ['hud.touchDrive', '📱 觸控開車', '📱 Touch drive', '📱 Conduite tactile', '📱 タッチ運転', '📱 터치 운전'],
  ['hud.padWake', '🎮 未偵測到搖桿（按任一鍵喚醒）', '🎮 No gamepad (press any button to wake it)', '🎮 Pas de manette (appuyez pour la réveiller)', '🎮 パッドなし（何か押して起こす）', '🎮 패드 없음 (버튼을 눌러 깨우기)'],
  ['hud.padNonstd', '（非標準映射，請至按鍵設定）', ' (nonstandard mapping — open Controls)', ' (mappage non standard — voir Commandes)', '（非標準マッピング。操作設定へ）', ' (비표준 매핑 — 조작 설정)'],
  ['cam.0', '追尾', 'Chase', 'Poursuite', '追従', '추적'],
  ['cam.1', '低角度', 'Low', 'Basse', 'ロー', '로우'],
  ['cam.2', '車內', 'Cockpit', 'Habitacle', '車内', '실내'],
  ['cam.3', '遠景', 'Far', 'Lointain', '遠景', '원경'],

  ['toast.padOn', '🎮 搖桿已連接', '🎮 Gamepad connected', '🎮 Manette connectée', '🎮 パッド接続', '🎮 패드 연결'],
  ['toast.padOff', '🎮 搖桿已中斷', '🎮 Gamepad disconnected', '🎮 Manette déconnectée', '🎮 パッド切断', '🎮 패드 해제'],
  ['toast.lapBest', '第 {n} 圈完成・新最佳！', 'Lap {n} done · new best!', 'Tour {n} · nouveau record !', '{n}周完了・新ベスト！', '{n}랩 완료 · 신기록!'],
  ['toast.lap', '第 {n} 圈完成', 'Lap {n} done', 'Tour {n} terminé', '{n}周完了', '{n}랩 완료'],
  ['toast.miss', '請沿賽道完整跑完一圈', 'Finish the lap on the track', 'Finissez le tour sur la piste', 'コースを外さず一周してください', '트랙을 따라 한 랩을 마치세요'],
  ['toast.left', '手機玩家已離開，比賽繼續', 'The phone player left. The race continues.', 'Le joueur mobile est parti. La course continue.', 'スマホのプレイヤーが退出しました。レースは続きます。', '휴대폰 플레이어가 나갔습니다. 경기는 계속됩니다.'],
  ['toast.hostPause', '房主暫停了', 'The host paused', 'L’hôte a mis en pause', 'ホストが一時停止しました', '호스트가 일시정지했습니다'],
  ['toast.fullScreen', '此瀏覽器不支援全螢幕', 'This browser has no full screen', 'Ce navigateur n’a pas le plein écran', 'このブラウザは全画面に対応していません', '이 브라우저는 전체 화면을 지원하지 않습니다'],
  ['toast.reset', '已回到賽道', 'Back on track', 'De retour en piste', 'コースに戻りました', '트랙으로 돌아왔습니다'],
  ['toast.offroad', '偏離賽道', 'Off the track', 'Hors piste', 'コースアウト', '트랙 이탈'],
  ['toast.ring', '⚡ 能量環  +能量 +加速', '⚡ Energy ring  +energy +speed', '⚡ Anneau  +énergie +vitesse', '⚡ エネルギーリング  +エネルギー +加速', '⚡ 에너지 링  +에너지 +가속'],
  ['toast.go', '出發！', 'GO!', 'PARTEZ !', 'スタート！', '출발!'],
  ['toast.canyon', '墜入峽谷！回到跳台前', 'Into the canyon! Back before the jump.', 'Dans le canyon ! Retour avant le saut.', '峡谷に落下！ジャンプの前に戻ります。', '협곡으로 추락! 점프 전으로 돌아갑니다.'],
  ['race.cpu', '電腦 {n}', 'CPU {n}', 'CPU {n}', 'COM {n}', 'COM {n}'],
  ['race.offline', '（離線）', ' (offline)', ' (hors ligne)', '（オフライン）', ' (오프라인)'],
  ['race.offlineMark', '離線', 'offline', 'hors ligne', 'オフライン', '오프라인'],

  ['load.wait', '載入中…', 'Loading…', 'Chargement…', '読み込み中…', '불러오는 중…'],
  ['load.step', '載入中：{label}…', 'Loading: {label}…', 'Chargement : {label}…', '読み込み中：{label}…', '불러오는 중: {label}…'],
  ['load.sky', '天空與光線', 'Sky and light', 'Ciel et lumière', '空と光', '하늘과 빛'],
  ['load.land', '地形', 'Terrain', 'Terrain', '地形', '지형'],
  ['load.road', '賽道路面', 'Track surface', 'Surface', '路面', '노면'],
  ['load.rails', '護欄與路標', 'Barriers and signs', 'Glissières', 'ガードレール', '가드레일'],
  ['load.rocks', '岩石與山脈', 'Rocks and hills', 'Rochers', '岩と山', '바위와 산'],
  ['load.rings', '能量環', 'Energy rings', 'Anneaux', 'エネルギーリング', '에너지 링'],
  ['load.extras', '特色結構', 'Set pieces', 'Décors', '仕掛け', '구조물'],
  ['load.done', '完成', 'Ready', 'Prêt', '完了', '완료'],
  ['load.car', '車輛', 'Cars', 'Voitures', '車両', '차량'],
  ['load.fail', '載入失敗：{msg}', 'Load failed: {msg}', 'Échec du chargement : {msg}', '読み込み失敗：{msg}', '불러오기 실패: {msg}'],
  ['boot.fail', '載入失敗，請重新整理或改用較新的瀏覽器。', 'Load failed. Refresh, or use a newer browser.', 'Échec du chargement. Actualisez, ou utilisez un navigateur plus récent.', '読み込みに失敗しました。更新するか、新しいブラウザを使ってください。', '불러오지 못했습니다. 새로고침하거나 더 새 브라우저를 쓰세요.'],
  ['boot.old', '此瀏覽器版本過舊，不支援 ES 模組 importmap（需要 Chromium 89 以上）。', 'This browser is too old for ES module import maps (Chromium 89 or newer).', 'Ce navigateur est trop ancien pour les import maps (Chromium 89 ou plus).', 'このブラウザは古すぎて import map に対応していません（Chromium 89 以上）。', '이 브라우저는 너무 오래되어 import map을 지원하지 않습니다 (Chromium 89 이상).'],
  ['boot.webgl', '此瀏覽器無法啟用 WebGL，無法執行遊戲。請改用較新的 Chromium 瀏覽器。', 'This browser cannot start WebGL, so the game cannot run. Use a newer Chromium browser.', 'Ce navigateur ne lance pas WebGL, le jeu ne peut pas démarrer. Utilisez un Chromium plus récent.', 'このブラウザは WebGL を起動できないため、ゲームを実行できません。新しい Chromium を使ってください。', '이 브라우저는 WebGL을 켤 수 없어 게임을 실행할 수 없습니다. 더 새 Chromium을 쓰세요.'],
  ['boot.err', '錯誤：{msg}', 'Error: {msg}', 'Erreur : {msg}', 'エラー：{msg}', '오류: {msg}'],

  ['lobby.empty', '（尚未回報手把槽）', '(no pad slots yet)', '(aucun emplacement de manette)', '（パッド枠はまだありません）', '(아직 패드 슬롯 없음)'],
  ['lobby.slotEmpty', '（空）', '(empty)', '(vide)', '（空）', '(빔)'],
  ['lobby.noId', '（無 id）', '(no id)', '(pas d’id)', '（id なし）', '(id 없음)'],
  ['lobby.nonstd', '（非標準）', '(nonstandard)', '(non standard)', '（非標準）', '(비표준)'],
  ['lobby.out', '未加入', 'Not joined', 'Pas entré', '未参加', '미참가'],
  ['lobby.virt', '車機虛擬（不使用）', 'Car virtual pad (unused)', 'Manette virtuelle (ignorée)', '車の仮想パッド（未使用）', '차량 가상 패드 (미사용)'],

  ['how.ws', '網頁中繼', 'Web relay', 'Relais web', 'ウェブリレー', '웹 중계'],
  ['how.turn', 'TURN 中繼', 'TURN relay', 'Relais TURN', 'TURN リレー', 'TURN 중계'],
  ['how.direct', '裝置直連', 'Direct', 'Direct', '直接接続', '직접 연결'],
  ['how.webrtc', 'WebRTC', 'WebRTC', 'WebRTC', 'WebRTC', 'WebRTC'],
  ['how.checking', '路徑確認中', 'Checking path', 'Chemin en cours', '経路確認中', '경로 확인 중'],
  ['how.joined', '已連上', 'Connected', 'Connecté', '接続済み', '연결됨'],
  ['rtc.ok', 'WebRTC 可用', 'WebRTC available', 'WebRTC disponible', 'WebRTC 利用可', 'WebRTC 사용 가능'],
  ['rtc.bad', 'WebRTC 不可用：{reason}', 'WebRTC unavailable: {reason}', 'WebRTC indisponible : {reason}', 'WebRTC 不可：{reason}', 'WebRTC 불가: {reason}'],
  ['ws.openWait', '網頁中繼：已連到伺服器，尚未跟手機確認', 'Web relay: on the server, phone not confirmed yet', 'Relais web : sur le serveur, téléphone pas encore confirmé', 'ウェブリレー：サーバー接続済み、スマホ未確認', '웹 중계: 서버 연결됨, 휴대폰 미확인'],
  ['ws.line', '網頁中繼：{reason}', 'Web relay: {reason}', 'Relais web : {reason}', 'ウェブリレー：{reason}', '웹 중계: {reason}'],
  ['ws.connecting', '連線中', 'connecting', 'connexion', '接続中', '연결 중'],
  ['ws.heard', '網頁中繼：車機有回應，正在加入…', 'Web relay: the car answered, joining…', 'Relais web : la voiture a répondu, entrée…', 'ウェブリレー：車が応答、参加中…', '웹 중계: 차량이 응답, 참가 중…'],
  ['ws.noHost', '網頁中繼：已連到伺服器，尚未跟車機確認', 'Web relay: on the server, car not confirmed yet', 'Relais web : sur le serveur, voiture pas encore confirmée', 'ウェブリレー：サーバー接続済み、車未確認', '웹 중계: 서버 연결됨, 차량 미확인'],
  ['ws.down', '沒有接通', 'not connected', 'non connecté', '未接続', '연결 안 됨'],
  ['peer.missing', '沒有載入 PeerJS', 'PeerJS did not load', 'PeerJS ne s’est pas chargé', 'PeerJS を読み込めませんでした', 'PeerJS를 불러오지 못했습니다'],
  ['peer.slow', '掃碼伺服器 10 秒沒有回應', 'The join server did not answer for 10 seconds', 'Le serveur n’a pas répondu pendant 10 secondes', '参加サーバーが 10 秒応答なし', '참가 서버가 10초간 응답 없음'],
  ['peer.ice', 'WebRTC ICE 失敗', 'WebRTC ICE failed', 'Échec ICE WebRTC', 'WebRTC ICE 失敗', 'WebRTC ICE 실패'],
  ['peer.rejoin', '掃碼登記中斷，正在用同一組代碼重新登記', 'Join listing dropped. Registering the same code again.', 'Inscription coupée. Nouvel essai avec le même code.', '参加登録が切れました。同じコードで再登録中。', '참가 등록이 끊겼습니다. 같은 코드로 다시 등록 중.'],
  ['peer.busy', '這組代碼暫時被占用，正在再用同一組登記', 'This code is briefly taken. Registering it again.', 'Ce code est pris un instant. Nouvel essai.', 'このコードは一時使用中。同じコードで再登録中。', '이 코드는 잠시 사용 중. 같은 코드로 다시 등록 중.'],
  ['peer.newCode', '代碼已更換，請重新掃描', 'The code changed. Scan again.', 'Le code a changé. Scannez à nouveau.', 'コードが変わりました。読み取り直してください。', '코드가 바뀌었습니다. 다시 스캔하세요.'],
  ['peer.unstable', '掃碼伺服器連線不穩', 'The join server is unstable', 'Le serveur d’entrée est instable', '参加サーバーが不安定です', '참가 서버가 불안정합니다'],
  ['peer.noWelcome', 'WebRTC 已接通，但 8 秒內沒有收到房主的歡迎訊息', 'WebRTC is up, but no welcome from the host in 8 seconds', 'WebRTC est ouvert, mais pas de bienvenue de l’hôte en 8 secondes', 'WebRTC は繋がりましたが、8秒以内にホストの歓迎がありません', 'WebRTC는 연결됐지만 8초 안에 호스트 환영이 없습니다'],
  ['peer.dc', 'WebRTC 資料通道錯誤', 'WebRTC data channel error', 'Erreur du canal de données WebRTC', 'WebRTC データチャネルエラー', 'WebRTC 데이터 채널 오류'],
  ['peer.timeout', 'WebRTC 超過 12 秒沒接通（車機 LTE 的 NAT，或瀏覽器擋住資料通道）', 'WebRTC did not connect in 12 seconds (car LTE NAT, or the browser blocked the data channel)', 'WebRTC sans connexion en 12 secondes (NAT LTE de la voiture, ou canal bloqué)', 'WebRTC が 12 秒で繋がらない（車の LTE NAT、またはデータチャネル遮断）', 'WebRTC가 12초 안에 연결되지 않음 (차량 LTE NAT, 또는 데이터 채널 차단)'],
  ['peer.noRoom', '掃碼伺服器上找不到房間 {code}（車機可能沒有登記成功）', 'Room {code} is not on the join server (the car may not have registered)', 'Salle {code} introuvable (la voiture n’est peut-être pas inscrite)', '参加サーバーに部屋 {code} がありません（車が登録できていない可能性）', '참가 서버에 방 {code}이 없습니다 (차량이 등록하지 못했을 수 있음)'],
  ['peer.detailNone', '沒有連上', 'not connected', 'non connecté', '未接続', '연결 안 됨'],
  ['peer.detailNone2', '沒有接通', 'not connected', 'non connecté', '未接続', '연결 안 됨'],
  ['host.hold', '階段：P3 訊號中斷，車輛先留在場上。{ws}。', 'Stage: P3 signal dropped. The car stays on track. {ws}.', 'Étape : signal P3 coupé. La voiture reste en piste. {ws}.', '段階：P3 の信号が切れました。車はコースに残します。{ws}。', '단계: P3 신호가 끊겼습니다. 차는 트랙에 둡니다. {ws}.'],
  ['host.joined', '階段：P3 已加入（{how}）。', 'Stage: P3 joined ({how}).', 'Étape : P3 a rejoint ({how}).', '段階：P3 参加（{how}）。', '단계: P3 참가 ({how}).'],
  ['host.linking', '階段：手機正在接通 WebRTC。{rtc}。{ws}。', 'Stage: the phone is opening WebRTC. {rtc}. {ws}.', 'Étape : le téléphone ouvre WebRTC. {rtc}. {ws}.', '段階：スマホが WebRTC 接続中。{rtc}。{ws}。', '단계: 휴대폰이 WebRTC를 여는 중. {rtc}. {ws}.'],
  ['host.fail', '階段：失敗。掃碼：{detail}。{ws}。{rtc}。本機比賽不受影響。', 'Stage: failed. Scan: {detail}. {ws}. {rtc}. This race is unaffected.', 'Étape : échec. Scan : {detail}. {ws}. {rtc}. Cette course continue.', '段階：失敗。スキャン：{detail}。{ws}。{rtc}。このレースは影響を受けません。', '단계: 실패. 스캔: {detail}. {ws}. {rtc}. 이 경기는 영향 없습니다.'],
  ['host.ready', '階段：房間已登記，等待手機。{rtc}。{ws}。', 'Stage: room listed, waiting for a phone. {rtc}. {ws}.', 'Étape : salle inscrite, en attente d’un téléphone. {rtc}. {ws}.', '段階：部屋を登録済み、スマホ待ち。{rtc}。{ws}。', '단계: 방 등록됨, 휴대폰 대기. {rtc}. {ws}.'],
  ['host.peerOnly', '階段：房間已登記在掃碼伺服器。{ws}。{rtc}。', 'Stage: room listed on the join server. {ws}. {rtc}.', 'Étape : salle inscrite sur le serveur. {ws}. {rtc}.', '段階：参加サーバーに部屋を登録済み。{ws}。{rtc}。', '단계: 참가 서버에 방 등록됨. {ws}. {rtc}.'],
  ['host.wsOnly', '階段：掃碼伺服器尚未登記（{detail}）。網頁中繼已連到伺服器，手機仍可加入。{rtc}。', 'Stage: not listed on the join server yet ({detail}). Web relay is on the server, a phone can still join. {rtc}.', 'Étape : pas encore inscrit ({detail}). Le relais web est sur le serveur, un téléphone peut entrer. {rtc}.', '段階：参加サーバー未登録（{detail}）。ウェブリレーはサーバー接続済み、スマホは参加できます。{rtc}。', '단계: 참가 서버 미등록 ({detail}). 웹 중계는 서버에 연결됨, 휴대폰은 참가할 수 있습니다. {rtc}.'],
  ['host.wait', '階段：正在向掃碼伺服器登記房間。{ws}。{rtc}。', 'Stage: listing the room on the join server. {ws}. {rtc}.', 'Étape : inscription de la salle. {ws}. {rtc}.', '段階：参加サーバーに部屋を登録中。{ws}。{rtc}。', '단계: 참가 서버에 방 등록 중. {ws}. {rtc}.'],
  ['guest.joined', '階段：已加入（{how}）。', 'Stage: joined ({how}).', 'Étape : rejoint ({how}).', '段階：参加しました（{how}）。', '단계: 참가함 ({how}).'],
  ['guest.fail', '階段：失敗。掃碼：{detail}。網頁中繼：{ws}。', 'Stage: failed. Scan: {detail}. Web relay: {ws}.', 'Étape : échec. Scan : {detail}. Relais web : {ws}.', '段階：失敗。スキャン：{detail}。ウェブリレー：{ws}。', '단계: 실패. 스캔: {detail}. 웹 중계: {ws}.'],
  ['guest.noRtc', '階段：這台手機沒有 WebRTC（{reason}）。{ws}', 'Stage: this phone has no WebRTC ({reason}). {ws}', 'Étape : ce téléphone n’a pas WebRTC ({reason}). {ws}', '段階：このスマホに WebRTC がありません（{reason}）。{ws}', '단계: 이 휴대폰에 WebRTC가 없습니다 ({reason}). {ws}'],
  ['guest.opened', '階段：WebRTC 已接通，等待房主歡迎訊息…', 'Stage: WebRTC is up, waiting for the host’s welcome…', 'Étape : WebRTC ouvert, en attente de l’hôte…', '段階：WebRTC 接続済み、ホストの歓迎待ち…', '단계: WebRTC 연결됨, 호스트 환영 대기…'],
  ['guest.detail', '階段：{detail}。{ws}', 'Stage: {detail}. {ws}', 'Étape : {detail}. {ws}', '段階：{detail}。{ws}', '단계: {detail}. {ws}'],
  ['guest.signal', '階段：已找到房間，正在建立 WebRTC（會試免費 TURN 中繼）…', 'Stage: room found, opening WebRTC (a free TURN relay will be tried)…', 'Étape : salle trouvée, ouverture WebRTC (relais TURN gratuit)…', '段階：部屋を発見、WebRTC 接続中（無料 TURN も試します）…', '단계: 방을 찾음, WebRTC 연결 중 (무료 TURN도 시도)…'],
  ['guest.find', '階段：掃碼伺服器已連上，正在尋找房間 {code}…', 'Stage: join server connected, looking for room {code}…', 'Étape : serveur connecté, recherche de la salle {code}…', '段階：参加サーバー接続済み、部屋 {code} を検索中…', '단계: 참가 서버 연결됨, 방 {code} 찾는 중…'],
  ['guest.boot', '階段：正在連上掃碼伺服器… {ws}', 'Stage: connecting to the join server… {ws}', 'Étape : connexion au serveur… {ws}', '段階：参加サーバーに接続中… {ws}', '단계: 참가 서버에 연결 중… {ws}'],
  ['guest.full', '這個房間已經有一位手機玩家。請等對方離開再加入。', 'This room already has a phone player. Wait for them to leave.', 'Cette salle a déjà un joueur mobile. Attendez qu’il parte.', 'この部屋にはすでにスマホのプレイヤーがいます。退出を待ってください。', '이 방에는 이미 휴대폰 플레이어가 있습니다. 나갈 때까지 기다리세요.'],
  ['guest.replaced', '已改由另一台手機加入這個房間。', 'Another phone took this room.', 'Un autre téléphone a pris cette salle.', '別のスマホがこの部屋に入りました。', '다른 휴대폰이 이 방에 들어왔습니다.'],
  ['guest.replacedBanner', '已改由另一台手機加入。', 'Another phone joined.', 'Un autre téléphone a rejoint.', '別のスマホが参加しました。', '다른 휴대폰이 참가했습니다.'],
  ['guest.dropLive', '連線中斷。比賽在房主那邊會繼續。正在重新連線…', 'Connection lost. The host’s race continues. Reconnecting…', 'Connexion coupée. La course de l’hôte continue. Reconnexion…', '接続が切れました。ホスト側のレースは続きます。再接続中…', '연결이 끊겼습니다. 호스트의 경기는 계속됩니다. 다시 연결 중…'],
  ['guest.drop', '連線中斷。正在重新連線…', 'Connection lost. Reconnecting…', 'Connexion coupée. Reconnexion…', '接続が切れました。再接続中…', '연결이 끊겼습니다. 다시 연결 중…'],
  ['guest.waitHost', '階段：已加入（{how}）。等待房主開始。', 'Stage: joined ({how}). Waiting for the host to start.', 'Étape : rejoint ({how}). En attente du départ.', '段階：参加しました（{how}）。ホストの開始待ち。', '단계: 참가함 ({how}). 호스트 시작 대기.'],
  ['guest.lost', '跟車機失去聯絡，正在重新接上…', 'Lost the car. Reconnecting…', 'Voiture perdue. Reconnexion…', '車と連絡が取れません。再接続中…', '차량과 연락이 끊겼습니다. 다시 연결 중…'],
  ['guest.scanning', '階段：正在連上掃碼伺服器…', 'Stage: connecting to the join server…', 'Étape : connexion au serveur…', '段階：参加サーバーに接続中…', '단계: 참가 서버에 연결 중…'],
  ['guest.inRoom', '已加入房間 {code}，等待房主開始', 'In room {code}, waiting for the host to start', 'Dans la salle {code}, en attente du départ', '部屋 {code} に参加、ホストの開始待ち', '방 {code} 참가, 호스트 시작 대기'],

  ['relay.failover', '中繼改接 {label}', 'Relay moved to {label}', 'Relais basculé vers {label}', 'リレーを {label} に変更', '중계를 {label}(으)로 변경'],
  ['relay.connecting', '正在連上 {label}', 'Connecting to {label}', 'Connexion à {label}', '{label} に接続中', '{label}에 연결 중'],
  ['relay.down', '{label} 無法開啟', '{label} could not be opened', '{label} n’a pas pu s’ouvrir', '{label} を開けません', '{label}을(를) 열 수 없음'],
  ['relay.timeout', '{label} 超過 6 秒沒有回應', '{label} did not answer within 6 seconds', '{label} sans réponse en 6 secondes', '{label} が 6 秒応答なし', '{label} 6초간 응답 없음'],
  ['relay.retry', '{label} 已中斷，重新連同一台', '{label} dropped. Retrying the same server.', '{label} coupé. Nouvel essai sur le même serveur.', '{label} が切断。同じサーバーに再接続。', '{label} 끊김. 같은 서버에 재연결.'],
  ['relay.closed', '{label} 已中斷', '{label} dropped', '{label} coupé', '{label} が切断', '{label} 끊김'],

  ['fail.browser', '這台瀏覽器不支援點對點連線，手機暫時無法加入。這台比賽不受影響。', 'This browser cannot do peer connections, so a phone cannot join yet. This race is unaffected.', 'Ce navigateur ne fait pas le pair-à-pair, un téléphone ne peut pas encore entrer. Cette course continue.', 'このブラウザはピア接続に対応していないため、スマホはまだ参加できません。このレースは影響を受けません。', '이 브라우저는 피어 연결을 지원하지 않아 휴대폰이 아직 참가할 수 없습니다. 이 경기는 영향 없습니다.'],
  ['fail.noRoom', '找不到這個房間。請核對代碼，並請房主留在遊戲頁面。', 'That room was not found. Check the code, and keep the host on the game page.', 'Salle introuvable. Vérifiez le code, et laissez l’hôte sur la page du jeu.', 'その部屋が見つかりません。コードを確認し、ホストはゲーム画面に留めてください。', '그 방을 찾지 못했습니다. 코드를 확인하고, 호스트는 게임 화면에 두세요.'],
  ['fail.taken', '這組房間代碼剛被使用，請再試一次。', 'That room code was just used. Try again.', 'Ce code vient d’être utilisé. Réessayez.', 'その部屋コードは使われたばかりです。もう一度。', '그 방 코드는 방금 사용됐습니다. 다시 하세요.'],
  ['fail.badCode', '房間代碼無效。', 'That room code is not valid.', 'Ce code de salle n’est pas valide.', '部屋コードが無効です。', '방 코드가 올바르지 않습니다.'],
  ['fail.generic', '連線失敗。請確認兩台裝置都有網路。嚴格的防火牆或對稱 NAT 可能擋下點對點連線。這台比賽不受影響。', 'Connection failed. Check that both devices have a network. A strict firewall or symmetric NAT can block the peer link. This race is unaffected.', 'Connexion échouée. Vérifiez le réseau des deux appareils. Un pare-feu strict ou un NAT symétrique peut bloquer le lien. Cette course continue.', '接続に失敗しました。両方のネットワークを確認してください。厳しいファイアウォールや対称 NAT がピア接続を止めることがあります。このレースは影響を受けません。', '연결에 실패했습니다. 두 장치의 네트워크를 확인하세요. 엄격한 방화벽이나 대칭 NAT가 피어 연결을 막을 수 있습니다. 이 경기는 영향 없습니다.'],

  ['stat.speed', '速度', 'Spd', 'Vit', '速度', '속도'],
  ['stat.accel', '加速', 'Acc', 'Acc', '加速', '가속'],
  ['stat.handling', '操控', 'Grip', 'Tenue', '操作', '조종'],
  ['stat.flight', '飛行', 'Fly', 'Vol', '飛行', '비행'],
  ['stat.tough', '堅固', 'Armor', 'Solide', '堅牢', '견고'],

  ['paint.silver', '銀灰', 'Silver', 'Argent', 'シルバー', '실버'],
  ['paint.blue', '午夜藍', 'Midnight blue', 'Bleu nuit', 'ミッドナイトブルー', '미드나잇 블루'],
  ['paint.red', '烈焰紅', 'Flame red', 'Rouge feu', 'フレイムレッド', '플레임 레드'],
  ['paint.white', '珍珠白', 'Pearl white', 'Blanc nacré', 'パールホワイト', '펄 화이트'],
  ['paint.black', '曜石黑', 'Obsidian', 'Obsidienne', 'オブシディアン', '옵시디언'],
  ['paint.steel', '拉絲不鏽鋼', 'Brushed steel', 'Acier brossé', 'ヘアライン鋼', '브러시드 스틸'],

  ['track.canyon.name', '峽谷沙漠', 'Canyon desert', 'Désert du canyon', '峡谷砂漠', '협곡 사막'],
  ['track.canyon.tag', '賽道 1', 'Track 1', 'Circuit 1', 'コース 1', '트랙 1'],
  ['track.canyon.desc', '日間峽谷沙漠環道，有三處飛躍缺口與護欄彎道。', 'A daytime canyon loop with three jumps and railed bends.', 'Boucle de jour dans un canyon, trois sauts et des virages à glissière.', '昼の峡谷周回。ジャンプ3か所とガードレールのカーブ。', '낮의 협곡 순환. 점프 세 곳과 가드레일 코너.'],
  ['track.coast.name', '海岸懸崖', 'Coast cliffs', 'Falaises côtières', '海岸の崖', '해안 절벽'],
  ['track.coast.tag', '賽道 2', 'Track 2', 'Circuit 2', 'コース 2', '트랙 2'],
  ['track.coast.desc', '日落海岸城市懸崖環道：橋樑、隧道與海上飛躍缺口。', 'A sunset coastal city: bridges, a tunnel, and jumps over the water.', 'Ville côtière au coucher du soleil : ponts, tunnel et sauts sur la mer.', '夕日の海岸都市。橋、トンネル、海のジャンプ。', '노을의 해안 도시. 다리, 터널, 바다 위 점프.'],
  ['track.alpine.name', '雪山夜道', 'Alpine night', 'Nuit alpine', '雪山の夜', '설산의 밤'],
  ['track.alpine.tag', '賽道 3', 'Track 3', 'Circuit 3', 'コース 3', '트랙 3'],
  ['track.alpine.desc', '夜間阿爾卑斯山道：髮夾彎、山谷大飛躍與發光能量環。', 'A night alpine road: hairpins, a valley jump, and glowing rings.', 'Route alpine de nuit : épingles, grand saut et anneaux lumineux.', '夜のアルプス。ヘアピン、谷の大ジャンプ、光るリング。', '밤의 알프스. 헤어핀, 계곡 점프, 빛나는 링.'],
  ['track.stunt.name', '迴旋試煉', 'Stunt trial', 'Essai acrobatique', '旋回の試練', '회전 시련'],
  ['track.stunt.tag', '賽道 4', 'Track 4', 'Circuit 4', 'コース 4', '트랙 4'],
  ['track.stunt.desc', '傾斜高牆、一段向前翻轉的迴旋，然後是倒吊直道。速度不夠會從倒吊段落下。接著平緩落地，再飛越一排原創停車。黃箭頭與檢查門標出路徑；卡住或衝出賽道約兩秒會回到上一道檢查門。', 'A banked wall, a forward loop, then an upside-down straight. Too slow and you fall off. Then a landing and a jump over a row of original parked cars. Yellow arrows and gates mark the path. Stuck or off the course for about two seconds sends you back to the last gate.', 'Mur incliné, looping vers l’avant, puis une ligne à l’envers. Trop lent, vous tombez. Puis un atterrissage et un saut au-dessus de voitures originales garées. Flèches jaunes et portes marquent le chemin. Bloqué ou hors piste environ deux secondes : retour à la dernière porte.', '傾斜の壁、前方宙返り、それから逆さの直線。遅いと落ちます。着地のあと、オリジナルの駐車車両を飛びます。黄矢印とゲートが道。約2秒止まったり外れると前のゲートに戻ります。', '기울어진 벽, 앞으로 도는 루프, 그다음 거꾸로 직선. 느리면 떨어집니다. 착지 뒤 원래 모양의 주차 차량을 넘습니다. 노란 화살과 문이 길. 약 2초 멈추거나 벗어나면 이전 문으로 돌아갑니다.'],

  ['veh.roadster.name', '新 Roadster', 'New Roadster', 'Nouveau Roadster', '新型ロードスター', '뉴 로드스터'],
  ['veh.roadster.tag', '雙座超跑', 'Two-seat supercar', 'Supercar 2 places', '2座スーパーカー', '2인승 슈퍼카'],
  ['veh.roadster.desc', '低矮寬體的雙座超跑，最快、最靈活，推進器飛行表現最好。', 'A low, wide two-seater. Fastest, sharpest, and the best on the lifters.', 'Biplace basse et large. La plus rapide, la plus vive, la meilleure en vol.', '低いワイドな2シーター。最速で最も機敏、浮上も最良。', '낮고 넓은 2인승. 가장 빠르고 날카로우며 부상도 최고.'],
  ['veh.model3.name', 'Model 3', 'Model 3', 'Model 3', 'Model 3', 'Model 3'],
  ['veh.model3.tag', '運動轎車', 'Sports sedan', 'Berline sport', 'スポーツセダン', '스포츠 세단'],
  ['veh.model3.desc', '輕巧均衡的四門轎車，轉向直接，適合入門。', 'A light, balanced four-door. Direct steering, easy to start with.', 'Berline légère et équilibrée. Direction directe, bon départ.', '軽くバランスの良い4ドア。ステアが素直で入門向き。', '가볍고 균형 잡힌 4도어. 조향이 직접적이고 입문에 좋습니다.'],
  ['veh.modely.name', 'Model Y', 'Model Y', 'Model Y', 'Model Y', 'Model Y'],
  ['veh.modely.tag', '緊湊休旅', 'Compact SUV', 'SUV compact', 'コンパクトSUV', '컴팩트 SUV'],
  ['veh.modely.desc', '車身較高的休旅車，穩定、續航佳，略重。', 'A taller crossover. Stable, good range, a bit heavy.', 'SUV plus haut. Stable, bonne endurance, un peu lourd.', '背の高いSUV。安定して航続が良く、やや重い。', '키가 큰 SUV. 안정적이고 항속이 좋으며 조금 무겁습니다.'],
  ['veh.models.name', 'Model S', 'Model S', 'Model S', 'Model S', 'Model S'],
  ['veh.models.tag', '旗艦轎車', 'Flagship sedan', 'Berline amirale', 'フラッグシップ', '플래그십 세단'],
  ['veh.models.desc', '長軸距的旗艦掀背轎車，加速強、極速高，操控偏穩。', 'A long flagship hatch. Strong acceleration, high speed, steady handling.', 'Grande berline hayon. Forte accélération, vitesse haute, tenue stable.', '長い旗艦ハッチバック。加速が強く最高速が高く、挙動は安定。', '긴 플래그십 해치. 가속이 강하고 최고속이 높으며 조향은 안정적입니다.'],
  ['veh.modelx.name', 'Model X', 'Model X', 'Model X', 'Model X', 'Model X'],
  ['veh.modelx.tag', '大型休旅', 'Large SUV', 'Grand SUV', '大型SUV', '대형 SUV'],
  ['veh.modelx.desc', '大型休旅車，車身堅固但偏重，飛行較吃力。（鷹翼門簡化為一般車門）', 'A large SUV. Tough but heavy, and harder to fly. (Falcon doors are simplified.)', 'Grand SUV. Solide mais lourd, plus dur à faire voler. (Portes simplifiées.)', '大型SUV。頑丈だが重く、飛行は苦しい。（観音ドアは通常ドアに簡略）', '대형 SUV. 튼튼하지만 무겁고 비행이 힘듭니다. (팔콘 도어는 일반 문으로 단순화.)'],
  ['veh.cybertruck.name', 'Cybertruck', 'Cybertruck', 'Cybertruck', 'Cybertruck', 'Cybertruck'],
  ['veh.cybertruck.tag', '不鏽鋼皮卡', 'Steel pickup', 'Pickup acier', 'ステンレスのピックアップ', '스테인리스 픽업'],
  ['veh.cybertruck.desc', '稜角分明的不鏽鋼皮卡，最耐撞的一般車；很重，起飛吃力、飛得低。', 'An angular steel pickup. The toughest everyday vehicle. Heavy, so it lifts slowly and stays low.', 'Pickup anguleux en acier. Le plus résistant des véhicules courants. Lourd : décollage lent, vol bas.', '角ばったステンレスのピックアップ。一般車で最も頑丈。重く、離陸が苦しく低く飛ぶ。', '각진 스테인리스 픽업. 일반 차 중 가장 튼튼합니다. 무거워 이륙이 힘들고 낮게 납니다.'],
  ['veh.semi.name', 'Semi', 'Semi', 'Semi', 'Semi', 'Semi'],
  ['veh.semi.tag', '電動卡車頭＋短拖車', 'Electric tractor and short trailer', 'Tracteur électrique et courte remorque', '電動トラクタ＋短トレーラー', '전기 트랙터와 짧은 트레일러'],
  ['veh.semi.desc', '卡車頭加短拖車：最重、最耐撞、最慢，但能量最多；推進器只能低空短飛。', 'Tractor and short trailer. Heaviest, toughest, slowest, but the most energy. The lifters only hop low and briefly.', 'Tracteur et courte remorque. Le plus lourd, le plus solide, le plus lent, mais le plus d’énergie. Les propulseurs ne font qu’un court vol bas.', 'トラクタと短いトレーラー。最も重く頑丈で遅いが、エネルギーは最大。浮上は低く短い。', '트랙터와 짧은 트레일러. 가장 무겁고 튼튼하고 느리지만 에너지가 가장 많습니다. 부상은 낮고 짧습니다.'],
  ['veh.cybercab.name', 'Cybercab', 'Cybercab', 'Cybercab', 'Cybercab', 'Cybercab'],
  ['veh.cybercab.tag', '雙座無人計程車', 'Two-seat robotaxi', 'Robotaxi deux places', '2座の無人タクシー', '2인승 무인 택시'],
  ['veh.cybercab.desc', '小巧圓潤的雙座車（沒有方向盤），轉向最靈活，輕盈好飛，但較不耐撞。', 'A small rounded two-seater with no wheel. The sharpest steering, light in the air, but less tough.', 'Petit biplace rond, sans volant. Direction la plus vive, léger en vol, moins solide.', '丸い小さな2座（ハンドルなし）。ステアは最も鋭く、軽くよく飛ぶが、頑丈さは低め。', '둥글고 작은 2인승(운전대 없음). 조향이 가장 날카롭고 공중에서 가볍지만 덜 튼튼합니다.'],
  ['veh.roadster08.name', '2008 Roadster', '2008 Roadster', 'Roadster 2008', '2008 ロードスター', '2008 로드스터'],
  ['veh.roadster08.tag', '經典雙座', 'Classic two-seater', 'Biplace classique', 'クラシック2座', '클래식 2인승'],
  ['veh.roadster08.desc', '初代雙座敞篷風格：輕巧、轉向靈活，極速略低，飛行輕盈。', 'A first-generation open two-seater. Light, nimble, a lower top speed, and easy in the air.', 'Biplace ouvert de première génération. Léger, agile, vitesse de pointe plus basse, vol facile.', '初代のオープン2座。軽く機敏、最高速はやや低く、飛行は軽い。', '1세대 오픈 2인승. 가볍고 민첩하며 최고속은 조금 낮고 비행은 가볍습니다.'],
  ['veh.model3p.name', 'Model 3 Performance', 'Model 3 Performance', 'Model 3 Performance', 'Model 3 Performance', 'Model 3 Performance'],
  ['veh.model3p.tag', '性能轎車', 'Performance sedan', 'Berline performance', '性能セダン', '퍼포먼스 세단'],
  ['veh.model3p.desc', 'Model 3 性能版：尾翼、更硬懸吊與更強加速，彎道抓地更好。', 'The performance Model 3: a wing, firmer suspension, stronger acceleration, and more grip.', 'Model 3 performance : aileron, suspension plus ferme, plus d’accélération et d’adhérence.', 'Model 3 の性能版。ウイング、硬い足、強い加速、コーナーのグリップが良い。', 'Model 3 퍼포먼스. 윙, 단단한 서스펜션, 더 강한 가속, 코너 접지력이 좋습니다.'],
  ['veh.modelyl.name', 'Model Y L', 'Model Y L', 'Model Y L', 'Model Y L', 'Model Y L'],
  ['veh.modelyl.tag', '加長六座休旅', 'Long six-seat SUV', 'SUV long six places', 'ロング6座SUV', '긴 6인승 SUV'],
  ['veh.modelyl.desc', '加長六座版 Model Y：車身長、空間大，較重但續航與堅固度提升。', 'The long six-seat Model Y. Longer and roomier, heavier, with more range and toughness.', 'Model Y long six places. Plus long, plus lourd, plus d’endurance et de solidité.', '6座ロングの Model Y。車体が長く広い。重いが航続と頑丈さが上がる。', '긴 6인승 Model Y. 차체가 길고 공간이 큽니다. 무겁지만 항속과 견고함이 오릅니다.'],
  ['veh.modelsplaid.name', 'Model S Plaid', 'Model S Plaid', 'Model S Plaid', 'Model S Plaid', 'Model S Plaid'],
  ['veh.modelsplaid.tag', '三馬達旗艦', 'Tri-motor flagship', 'Amirale trimoteur', '3モーター旗艦', '3모터 플래그십'],
  ['veh.modelsplaid.desc', 'Model S 三馬達性能版：加速與極速頂尖，附尾翼。', 'The tri-motor Model S. Top acceleration and speed, with a wing.', 'Model S trimoteur. Accélération et vitesse au sommet, avec un aileron.', '3モーターの Model S。加速と最高速は頂点、ウイング付き。', '3모터 Model S. 가속과 최고속이 정점이고 윙이 있습니다.'],
  ['veh.modelxplaid.name', 'Model X Plaid', 'Model X Plaid', 'Model X Plaid', 'Model X Plaid', 'Model X Plaid'],
  ['veh.modelxplaid.tag', '三馬達休旅', 'Tri-motor SUV', 'SUV trimoteur', '3モーターSUV', '3모터 SUV'],
  ['veh.modelxplaid.desc', 'Model X 三馬達版：休旅身形但加速兇猛，飛行仍偏吃力。', 'The tri-motor Model X. An SUV shape with fierce acceleration, still hard to fly.', 'Model X trimoteur. Silhouette de SUV, accélération féroce, vol encore difficile.', '3モーターの Model X。SUVの形で加速は激しいが、飛行はまだ苦しい。', '3모터 Model X. SUV 실루엣에 가속은 사납지만 비행은 여전히 힘듭니다.'],
  ['veh.cyberbeast.name', 'Cyberbeast', 'Cyberbeast', 'Cyberbeast', 'Cyberbeast', 'Cyberbeast'],
  ['veh.cyberbeast.tag', '三馬達皮卡', 'Tri-motor pickup', 'Pickup trimoteur', '3モーターのピックアップ', '3모터 픽업'],
  ['veh.cyberbeast.desc', 'Cybertruck 三馬達「野獸」版：加速更猛、更耐撞，仍飛得低。', 'The tri-motor Cybertruck. Harder acceleration, tougher still, and it still flies low.', 'Cybertruck trimoteur. Plus d’accélération, encore plus solide, et il vole toujours bas.', 'Cybertruck の3モーター「ビースト」。加速はより激しく、より頑丈、飛行はやはり低い。', 'Cybertruck 3모터. 가속은 더 사납고 더 튼튼하며, 여전히 낮게 납니다.'],
  ['veh.robovan.name', 'Robovan', 'Robovan', 'Robovan', 'Robovan', 'Robovan'],
  ['veh.robovan.tag', '無人廂型車', 'Driverless van', 'Fourgon sans conducteur', '無人バン', '무인 밴'],
  ['veh.robovan.desc', '低矮修長的無人廂型車：穩定、空間大、續航長，轉向偏鈍。', 'A low, long driverless van. Stable, roomy, long range, and slower to turn.', 'Fourgon bas et long, sans conducteur. Stable, spacieux, longue endurance, direction plus lente.', '低く長い無人バン。安定して広く航続が長いが、ステアは鈍い。', '낮고 긴 무인 밴. 안정적이고 공간이 넓고 항속이 길지만 조향은 둔합니다.'],

  ['gp.title', '搖桿測試 — 天空飛馳', 'Gamepad test — Sky Roadster', 'Test manette — Sky Roadster', 'パッドテスト — スカイロードスター', '패드 테스트 — 스카이 로드스터'],
  ['gp.back', '← 回到遊戲', '← Back to the game', '← Retour au jeu', '← ゲームに戻る', '← 게임으로'],
  ['gp.wait', '尚未偵測到搖桿：請接上搖桿（藍牙或 USB 接收器），並按下任意按鍵來喚醒。', 'No gamepad yet. Plug one in (Bluetooth or USB) and press any button to wake it.', 'Pas de manette. Branchez-la (Bluetooth ou USB) et appuyez pour la réveiller.', 'パッド未検出。Bluetooth か USB で接続し、何か押して起こしてください。', '패드 없음. 블루투스나 USB로 연결하고 버튼을 눌러 깨우세요.'],
  ['gp.connected', '✅ 已連接：{id}', '✅ Connected: {id}', '✅ Connectée : {id}', '✅ 接続中：{id}', '✅ 연결됨: {id}'],
  ['gp.id', '裝置名稱 id', 'Device id', 'Nom (id)', '装置名 id', '장치 id'],
  ['gp.mapping', '映射 mapping', 'Mapping', 'Mappage', 'マッピング', '매핑'],
  ['gp.index', '索引 index', 'Index', 'Index', 'インデックス', '인덱스'],
  ['gp.profile', '偵測的設定檔', 'Detected profile', 'Profil détecté', '検出プロファイル', '감지된 프로필'],
  ['gp.invert', '轉向左右反轉', 'Invert steering', 'Inverser', 'ステア反転', '조향 반전'],
  ['gp.invertOff', '關（預設）', 'Off (default)', 'Non (défaut)', 'オフ（標準）', '끔 (기본)'],
  ['gp.invertOn', '開', 'On', 'Oui', 'オン', '켬'],
  ['gp.invertNote', '與遊戲共用設定；左搖桿往右 = 遊戲向右轉', 'Shared with the game. Stick right = steer right.', 'Partagé avec le jeu. Stick à droite = virage à droite.', 'ゲームと共通。スティック右 = ゲームも右。', '게임과 공유. 스틱 오른쪽 = 게임도 오른쪽.'],
  ['gp.preview', '轉向預覽', 'Steer preview', 'Aperçu', 'ステアプレビュー', '조향 미리보기'],
  ['gp.mode', '手動模式', 'Manual mode', 'Mode manuel', '手動モード', '수동 모드'],
  ['gp.modeNote', '與遊戲共用設定', 'Shared with the game', 'Partagé avec le jeu', 'ゲームと共通', '게임과 공유'],
  ['gp.mode.auto', '自動偵測', 'Auto', 'Auto', '自動', '자동'],
  ['gp.mode.switch', 'Switch 模式', 'Switch', 'Switch', 'Switch', 'Switch'],
  ['gp.mode.xbox', 'X-input（Xbox）模式', 'X-input (Xbox)', 'X-input (Xbox)', 'X-input（Xbox）', 'X-input (Xbox)'],
  ['gp.hat', '十字鍵 hat', 'D-pad hat', 'Croix (hat)', '十字 hat', '십자 hat'],
  ['gp.counts', '按鈕 / 軸數量', 'Buttons / axes', 'Boutons / axes', 'ボタン / 軸', '버튼 / 축'],
  ['gp.rumble', '震動支援', 'Rumble', 'Vibration', '振動', '진동'],
  ['gp.switch', '多支搖桿時可切換：', 'If several pads are connected:', 'S’il y a plusieurs manettes :', '複数パッドの切り替え：', '패드가 여러 개일 때:'],
  ['gp.vibTitle', '震動測試', 'Rumble test', 'Test vibration', '振動テスト', '진동 테스트'],
  ['gp.vibStrong', '強震', 'Strong', 'Fort', '強', '강하게'],
  ['gp.vibWeak', '弱震', 'Soft', 'Faible', '弱', '약하게'],
  ['gp.vibBoth', '雙馬達', 'Both', 'Les deux', '両方', '둘 다'],
  ['gp.vibLong', '連續 3 秒', '3 seconds', '3 secondes', '3秒連続', '3초 연속'],
  ['gp.vibNote', '（不一定每種連接方式都支援）', '(not every connection supports this)', '(pas toujours pris en charge)', '（接続方式によっては非対応）', '(연결 방식에 따라 미지원)'],
  ['gp.log', '最近事件', 'Recent events', 'Événements', '最近の出来事', '최근 이벤트'],
  ['gp.json', '可複製的 JSON 摘要', 'JSON you can copy', 'JSON à copier', 'コピーできる JSON', '복사할 JSON'],
  ['gp.jsonHint', '（可截圖或貼給開發者）', '(screenshot it or paste it to a developer)', '(capture ou collez-le à un développeur)', '（撮るか開発者に貼る）', '(찍거나 개발자에게 붙이세요)'],
  ['gp.copy', '複製 JSON', 'Copy JSON', 'Copier', 'JSON をコピー', 'JSON 복사'],
  ['gp.clear', '清除紀錄', 'Clear', 'Effacer', '記録を消す', '기록 지우기'],
  ['gp.buttons', '按鈕（索引 0–N；亮橘＝目前按下，綠框＝曾按過）', 'Buttons (index 0–N; orange = held, green = pressed once)', 'Boutons (0–N ; orange = enfoncé, vert = déjà pressé)', 'ボタン（0–N。橙＝押している、緑枠＝押したことがある）', '버튼 (0–N. 주황 = 누르는 중, 초록 = 한 번 누름)'],
  ['gp.axes', '搖桿軸（數值 −1 ～ +1）', 'Axes (value −1 to +1)', 'Axes (valeur −1 à +1)', '軸（値 −1 ～ +1）', '축 (값 −1 ~ +1)'],
  ['gp.foot', '提醒：瀏覽器的 Gamepad API 只提供按鈕與搖桿軸，無法讀取陀螺儀或震動回饋以外的感測器。請依序按每一顆鍵、推每一根搖桿、壓兩個板機，再截圖整頁。', 'The Gamepad API only reports buttons and axes, not a gyro or other sensors. Press every button, move every stick, pull both triggers, then screenshot the page.', 'L’API Gamepad ne donne que boutons et axes, pas le gyro. Appuyez sur chaque touche, bougez chaque stick, tirez les deux gâchettes, puis capturez la page.', 'Gamepad API はボタンと軸だけです。ジャイロは読めません。全部のボタン、スティック、両方のトリガーを試し、ページを撮ってください。', 'Gamepad API는 버튼과 축만 알려 줍니다. 자이로는 읽지 못합니다. 모든 버튼, 스틱, 두 트리거를 누른 뒤 페이지를 찍으세요.'],
  ['gp.btn', '按鈕 {i}', 'Button {i}', 'Bouton {i}', 'ボタン {i}', '버튼 {i}'],
  ['gp.stdName', '(標準名：{name})', '(standard: {name})', '(standard : {name})', '（標準名：{name}）', '(표준: {name})'],
  ['gp.axis', '軸 {i}', 'Axis {i}', 'Axe {i}', '軸 {i}', '축 {i}'],
  ['gp.range', '最小 {min} ／ 最大 {max}', 'min {min} / max {max}', 'min {min} / max {max}', '最小 {min} ／ 最大 {max}', '최소 {min} / 최대 {max}'],
  ['gp.rangeEmpty', '最小 — 最大 —', 'min — max —', 'min — max —', '最小 — 最大 —', '최소 — 최대 —'],
  ['gp.hatNone', '無', 'none', 'aucun', 'なし', '없음'],
  ['gp.hatDirs', '上|右上|右|右下|下|左下|左|左上', 'up|up-right|right|down-right|down|down-left|left|up-left', 'haut|haut-droite|droite|bas-droite|bas|bas-gauche|gauche|haut-gauche', '上|右上|右|右下|下|左下|左|左上', '위|오른쪽 위|오른쪽|오른쪽 아래|아래|왼쪽 아래|왼쪽|왼쪽 위'],
  ['gp.detect.xbox', 'Xbox', 'Xbox', 'Xbox', 'Xbox', 'Xbox'],
  ['gp.detect.switch', 'Switch Pro', 'Switch Pro', 'Switch Pro', 'Switch Pro', 'Switch Pro'],
  ['gp.detect.generic', '一般搖桿（以 Xbox 標示）', 'Generic pad (Xbox labels)', 'Manette générique (noms Xbox)', '一般パッド（Xbox 表記）', '일반 패드 (Xbox 이름)'],
  ['gp.profileLine', '{name}{mode}{switchNote}', '{name}{mode}{switchNote}', '{name}{mode}{switchNote}', '{name}{mode}{switchNote}', '{name}{mode}{switchNote}'],
  ['gp.autoTag', '（自動偵測）', ' (auto)', ' (auto)', '（自動）', ' (자동)'],
  ['gp.manualTag', '（手動指定）', ' (manual)', ' (manuel)', '（手動）', ' (수동)'],
  ['gp.switchNote', '（按鈕標示為任天堂：下＝B、右＝A、左＝Y、上＝X）', ' (Nintendo labels: down = B, right = A, left = Y, up = X)', ' (noms Nintendo : bas = B, droite = A, gauche = Y, haut = X)', '（任天堂表記：下＝B、右＝A、左＝Y、上＝X）', ' (닌텐도 이름: 아래 = B, 오른쪽 = A, 왼쪽 = Y, 위 = X)'],
  ['gp.steerLine', '左搖桿 X={x} → 遊戲轉向：{dir}{inv}', 'Left stick X={x} → steer: {dir}{inv}', 'Stick gauche X={x} → direction : {dir}{inv}', '左スティック X={x} → ステア：{dir}{inv}', '왼쪽 스틱 X={x} → 조향: {dir}{inv}'],
  ['gp.straight', '直行', 'straight', 'tout droit', '直進', '직진'],
  ['gp.right', '向右 {n}%', 'right {n}%', 'droite {n} %', '右 {n}%', '오른쪽 {n}%'],
  ['gp.left', '向左 {n}%', 'left {n}%', 'gauche {n} %', '左 {n}%', '왼쪽 {n}%'],
  ['gp.inverted', '（已反轉）', ' (inverted)', ' (inversé)', '（反転）', ' (반전)'],
  ['gp.mapBlank', '（空白＝非標準映射，按鍵編號可能與 Xbox 不同）', '(blank = nonstandard, indexes may differ from Xbox)', '(vide = non standard, index peut différer d’Xbox)', '（空白＝非標準。番号が Xbox と違うことがあります）', '(비어 있음 = 비표준, 번호가 Xbox와 다를 수 있음)'],
  ['gp.countLine', '{buttons} 個按鈕 / {axes} 個軸', '{buttons} buttons / {axes} axes', '{buttons} boutons / {axes} axes', '{buttons} ボタン / {axes} 軸', '버튼 {buttons} / 축 {axes}'],
  ['gp.rumbleAct', 'vibrationActuator（{type}）', 'vibrationActuator ({type})', 'vibrationActuator ({type})', 'vibrationActuator（{type}）', 'vibrationActuator ({type})'],
  ['gp.rumbleOld', 'hapticActuators（舊式）', 'hapticActuators (legacy)', 'hapticActuators (ancien)', 'hapticActuators（旧）', 'hapticActuators (구형)'],
  ['gp.rumbleNo', '不支援', 'unsupported', 'non pris en charge', '非対応', '미지원'],
  ['gp.hatStd', '標準映射：十字鍵為按鈕 12–15', 'Standard mapping: D-pad is buttons 12–15', 'Mappage standard : croix = boutons 12–15', '標準：十字はボタン 12–15', '표준: 십자키는 버튼 12–15'],
  ['gp.hatMiss', '未偵測到 hat 軸', 'No hat axis detected', 'Pas d’axe hat', 'hat 軸なし', 'hat 축 없음'],
  ['gp.hatFound', '軸 {axes}：{dir}', 'Axis {axes}: {dir}', 'Axe {axes} : {dir}', '軸 {axes}：{dir}', '축 {axes}: {dir}'],
  ['gp.ignore', '遊戲會忽略此軸：靜止值 {rest}{hat}', 'The game ignores this axis: rest {rest}{hat}', 'Le jeu ignore cet axe : repos {rest}{hat}', 'ゲームはこの軸を無視：静止値 {rest}{hat}', '게임은 이 축을 무시: 정지값 {rest}{hat}'],
  ['gp.hatNow', '（十字鍵 hat：目前 {dir}）', ' (D-pad hat, now {dir})', ' (hat, maintenant {dir})', '（十字 hat：今 {dir}）', ' (십자 hat, 현재 {dir})'],
  ['gp.bias', '搖桿偏心 {n}（遊戲會自動校正）', 'Stick offset {n} (the game recenters it)', 'Décalage {n} (le jeu recentre)', '偏心 {n}（ゲームが自動補正）', '스틱 치우침 {n} (게임이 자동 보정)'],
  ['gp.logOn', '連接：[{index}] {id}', 'Connected: [{index}] {id}', 'Connectée : [{index}] {id}', '接続：[{index}] {id}', '연결: [{index}] {id}'],
  ['gp.logOff', '中斷：[{index}] {id}', 'Disconnected: [{index}] {id}', 'Déconnectée : [{index}] {id}', '切断：[{index}] {id}', '해제: [{index}] {id}'],
  ['gp.logBtn', '按鈕 {i}{name} 按下 value={value}', 'Button {i}{name} down value={value}', 'Bouton {i}{name} enfoncé valeur={value}', 'ボタン {i}{name} 押下 value={value}', '버튼 {i}{name} 누름 value={value}'],
  ['gp.logName', '（{name}）', ' ({name})', ' ({name})', '（{name}）', ' ({name})'],
  ['gp.logInv', '轉向左右反轉：{state}', 'Invert steering: {state}', 'Inversion : {state}', 'ステア反転：{state}', '조향 반전: {state}'],
  ['gp.logMode', '搖桿模式：{mode}', 'Pad mode: {mode}', 'Mode manette : {mode}', 'パッドモード：{mode}', '패드 모드: {mode}'],
  ['gp.noPad', '沒有搖桿', 'No gamepad', 'Pas de manette', 'パッドなし', '패드 없음'],
  ['gp.vibSent', '已送出震動，結果：{result}', 'Rumble sent, result: {result}', 'Vibration envoyée, résultat : {result}', '振動を送信、結果：{result}', '진동 전송, 결과: {result}'],
  ['gp.vibLog', '震動 {strong}/{weak} {ms}ms → {result}', 'Rumble {strong}/{weak} {ms}ms → {result}', 'Vibration {strong}/{weak} {ms} ms → {result}', '振動 {strong}/{weak} {ms}ms → {result}', '진동 {strong}/{weak} {ms}ms → {result}'],
  ['gp.vibFail', '震動失敗：{err}', 'Rumble failed: {err}', 'Vibration échouée : {err}', '振動失敗：{err}', '진동 실패: {err}'],
  ['gp.vibLegacy', '已用舊式 hapticActuators 震動', 'Used the legacy hapticActuators rumble', 'Vibration via l’ancien hapticActuators', '旧式 hapticActuators で振動', '구형 hapticActuators로 진동'],
  ['gp.vibUnsupported', '此搖桿 / 瀏覽器不支援震動（遊戲內會自動略過）', 'This pad or browser has no rumble (the game skips it)', 'Cette manette ou ce navigateur ne vibre pas (le jeu l’ignore)', 'このパッド／ブラウザは振動非対応（ゲームは省略）', '이 패드나 브라우저는 진동이 없습니다 (게임은 건너뜁니다)'],
  ['gp.vibErr', '震動錯誤：{err}', 'Rumble error: {err}', 'Erreur de vibration : {err}', '振動エラー：{err}', '진동 오류: {err}'],
  ['gp.cleared', '已清除', 'Cleared', 'Effacé', '消去しました', '지웠습니다'],
  ['gp.copied', '已複製', 'Copied', 'Copié', 'コピーしました', '복사했습니다'],
  ['gp.copyFallback', '已複製（或請長按文字框手動全選）', 'Copied (or long-press the box and select all)', 'Copié (ou appui long dans la zone)', 'コピー（または長押しで全選択）', '복사함 (또는 칸을 길게 눌러 전체 선택)'],
  ['gp.copyManual', '請長按文字框手動全選複製', 'Long-press the box and copy it yourself', 'Appui long dans la zone, puis copiez', '長押しで全選択してコピーしてください', '칸을 길게 눌러 직접 복사하세요'],
];

function buildDicts(rows) {
  const dicts = {};
  for (const loc of LOCALES) dicts[loc] = {};
  for (const row of rows) {
    const key = row[0];
    for (let i = 0; i < LOCALES.length; i++) dicts[LOCALES[i]][key] = row[i + 1];
  }
  return dicts;
}

export const DICTS = buildDicts(ROWS);

let locale = 'zh-TW';
const listeners = [];

export function canonicalLocale(raw) {
  const s = String(raw || '').trim().replace(/_/g, '-').toLowerCase();
  if (!s) return '';
  if (ALIAS[s]) return ALIAS[s];
  const base = s.split('-')[0];
  return ALIAS[base] || '';
}

export function pickLocale({ saved, param, nav } = {}) {
  const fromSaved = canonicalLocale(saved);
  if (fromSaved) return fromSaved;
  const fromParam = canonicalLocale(param);
  if (fromParam) return fromParam;
  const fromNav = canonicalLocale(nav);
  if (fromNav) return fromNav;
  return 'zh-TW';
}

export function getLocale() { return locale; }

export function htmlLang(code = locale) {
  return code === 'zh-TW' ? 'zh-Hant-TW' : code;
}

export function t(key, vars) {
  const pack = DICTS[locale] || DICTS['zh-TW'];
  let s = pack[key];
  if (s == null || s === '') s = DICTS['zh-TW'][key];
  if (s == null) return key;
  if (vars) {
    for (const name of Object.keys(vars)) s = s.split('{' + name + '}').join(vars[name] == null ? '' : String(vars[name]));
  }
  return s;
}

export function trackText(id) {
  return { name: t('track.' + id + '.name'), tag: t('track.' + id + '.tag'), desc: t('track.' + id + '.desc') };
}
export function vehicleText(id, fallbackName) {
  const key = 'veh.' + id + '.name';
  const name = (DICTS[locale] && DICTS[locale][key]) || fallbackName || id;
  return { name, tag: t('veh.' + id + '.tag'), desc: t('veh.' + id + '.desc') };
}
export function paintLabel(key) { return t('paint.' + key); }

function applyDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = htmlLang(locale);
  document.documentElement.dataset.langReady = '1';
  const title = document.querySelector('title[data-i18n]');
  if (title) title.textContent = t(title.dataset.i18n);
  else if (document.title && document.getElementById('gl')) document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

export function applyDom() { applyDocument(); }

export function onLocale(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

export function setLocale(next) {
  const code = canonicalLocale(next);
  if (!code) return locale;
  locale = code;
  try { store.set('lang', code); } catch (e) {}
  applyDocument();
  for (const fn of listeners) { try { fn(code); } catch (e) {} }
  return locale;
}

export function initLocale() {
  let param = '';
  let nav = '';
  try { param = new URLSearchParams(globalThis.location && globalThis.location.search || '').get('lang') || ''; } catch (e) {}
  try { nav = (globalThis.navigator && (globalThis.navigator.language || (globalThis.navigator.languages && globalThis.navigator.languages[0]))) || ''; } catch (e) {}
  let saved = '';
  try { saved = store.get('lang', '') || ''; } catch (e) {}
  locale = pickLocale({ saved, param, nav });
  applyDocument();
  return locale;
}
