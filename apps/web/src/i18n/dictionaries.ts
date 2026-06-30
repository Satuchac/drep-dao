import type { LangCode } from './types';

// Translations, keyed by the English source string (see types.ts). English is the source
// language and needs no entry — a missing key (or missing language) falls back to the English
// text, so the UI is always readable while translation is in progress.
//
// Structure is key-major: each English string lists all its translations together, so wiring a
// new component means adding one block per new string with every language in one place. Order of
// languages within a block: es zh ja de ru it fr pt ko ar hi.

type Translations = Partial<Record<LangCode, string>>;

const T: Record<string, Translations> = {
  // ---- App shell: navigation, landing, login box ----
  'My area': { es: 'Mi área', zh: '我的区域', ja: 'マイエリア', de: 'Mein Bereich', ru: 'Мой раздел', it: 'La mia area', fr: 'Mon espace', pt: 'Minha área', ko: '내 영역', ar: 'منطقتي', hi: 'मेरा क्षेत्र' },
  'DAO Member overview': { es: 'Resumen de miembros de la DAO', zh: 'DAO 成员概览', ja: 'DAO メンバー概要', de: 'DAO-Mitgliederübersicht', ru: 'Обзор участников DAO', it: 'Panoramica membri della DAO', fr: 'Aperçu des membres de la DAO', pt: 'Visão geral dos membros da DAO', ko: 'DAO 회원 개요', ar: 'نظرة عامة على أعضاء DAO', hi: 'DAO सदस्य अवलोकन' },
  'DAO members': { es: 'Miembros de la DAO', zh: 'DAO 成员', ja: 'DAO メンバー', de: 'DAO-Mitglieder', ru: 'Участники DAO', it: 'Membri della DAO', fr: 'Membres de la DAO', pt: 'Membros da DAO', ko: 'DAO 회원', ar: 'أعضاء DAO', hi: 'DAO सदस्य' },
  Submitters: { es: 'Proponentes', zh: '提交者', ja: '提出者', de: 'Einreicher', ru: 'Заявители', it: 'Proponenti', fr: 'Soumetteurs', pt: 'Proponentes', ko: '제출자', ar: 'مقدمو الطلبات', hi: 'प्रस्तुतकर्ता' },
  Experts: { es: 'Expertos', zh: '专家', ja: '専門家', de: 'Experten', ru: 'Эксперты', it: 'Esperti', fr: 'Experts', pt: 'Especialistas', ko: '전문가', ar: 'الخبراء', hi: 'विशेषज्ञ' },
  Rounds: { es: 'Rondas', zh: '轮次', ja: 'ラウンド', de: 'Runden', ru: 'Раунды', it: 'Round', fr: 'Tours', pt: 'Rodadas', ko: '라운드', ar: 'الجولات', hi: 'राउंड' },
  'Funding proposals': { es: 'Propuestas de financiación', zh: '资助提案', ja: '資金提案', de: 'Förderanträge', ru: 'Заявки на финансирование', it: 'Proposte di finanziamento', fr: 'Propositions de financement', pt: 'Propostas de financiamento', ko: '자금 제안', ar: 'مقترحات التمويل', hi: 'वित्तपोषण प्रस्ताव' },
  'Internal proposals': { es: 'Propuestas internas', zh: '内部提案', ja: '内部提案', de: 'Interne Anträge', ru: 'Внутренние предложения', it: 'Proposte interne', fr: 'Propositions internes', pt: 'Propostas internas', ko: '내부 제안', ar: 'المقترحات الداخلية', hi: 'आंतरिक प्रस्ताव' },
  'On-chain proofs': { es: 'Pruebas on-chain', zh: '链上凭证', ja: 'オンチェーン証明', de: 'On-Chain-Nachweise', ru: 'Ончейн-доказательства', it: 'Prove on-chain', fr: 'Preuves on-chain', pt: 'Provas on-chain', ko: '온체인 증명', ar: 'إثباتات على السلسلة', hi: 'ऑन-चेन प्रमाण' },
  Treasury: { es: 'Tesorería', zh: '金库', ja: 'トレジャリー', de: 'Schatzkammer', ru: 'Казначейство', it: 'Tesoreria', fr: 'Trésorerie', pt: 'Tesouraria', ko: '재무', ar: 'الخزينة', hi: 'कोष' },
  'Platform setup': { es: 'Configuración de la plataforma', zh: '平台设置', ja: 'プラットフォーム設定', de: 'Plattform-Einrichtung', ru: 'Настройка платформы', it: 'Configurazione della piattaforma', fr: 'Configuration de la plateforme', pt: 'Configuração da plataforma', ko: '플랫폼 설정', ar: 'إعداد المنصة', hi: 'प्लेटफ़ॉर्म सेटअप' },
  'Cardano governance platform (Preprod).': { es: 'Plataforma de gobernanza de Cardano (Preprod).', zh: 'Cardano 治理平台（Preprod）。', ja: 'Cardano ガバナンスプラットフォーム（Preprod）。', de: 'Cardano-Governance-Plattform (Preprod).', ru: 'Платформа управления Cardano (Preprod).', it: 'Piattaforma di governance Cardano (Preprod).', fr: 'Plateforme de gouvernance Cardano (Preprod).', pt: 'Plataforma de governança Cardano (Preprod).', ko: 'Cardano 거버넌스 플랫폼 (Preprod).', ar: 'منصة حوكمة Cardano (Preprod).', hi: 'Cardano गवर्नेंस प्लेटफ़ॉर्म (Preprod)।' },
  'View profile': { es: 'Ver perfil', zh: '查看资料', ja: 'プロフィールを見る', de: 'Profil anzeigen', ru: 'Профиль', it: 'Vedi profilo', fr: 'Voir le profil', pt: 'Ver perfil', ko: '프로필 보기', ar: 'عرض الملف الشخصي', hi: 'प्रोफ़ाइल देखें' },
  'Refresh notifications / to-do counts': { es: 'Actualizar notificaciones / tareas pendientes', zh: '刷新通知 / 待办事项', ja: '通知 / タスクを更新', de: 'Benachrichtigungen / Aufgaben aktualisieren', ru: 'Обновить уведомления / задачи', it: 'Aggiorna notifiche / attività', fr: 'Actualiser les notifications / tâches', pt: 'Atualizar notificações / tarefas', ko: '알림 / 할 일 새로고침', ar: 'تحديث الإشعارات / المهام', hi: 'सूचनाएँ / कार्य ताज़ा करें' },
  'Refresh notifications': { es: 'Actualizar notificaciones', zh: '刷新通知', ja: '通知を更新', de: 'Benachrichtigungen aktualisieren', ru: 'Обновить уведомления', it: 'Aggiorna notifiche', fr: 'Actualiser les notifications', pt: 'Atualizar notificações', ko: '알림 새로고침', ar: 'تحديث الإشعارات', hi: 'सूचनाएँ ताज़ा करें' },
  Language: { es: 'Idioma', zh: '语言', ja: '言語', de: 'Sprache', ru: 'Язык', it: 'Lingua', fr: 'Langue', pt: 'Idioma', ko: '언어', ar: 'اللغة', hi: 'भाषा' },
  Theme: { es: 'Tema', zh: '主题', ja: 'テーマ', de: 'Design', ru: 'Тема', it: 'Tema', fr: 'Thème', pt: 'Tema', ko: '테마', ar: 'المظهر', hi: 'थीम' },
  Light: { es: 'Claro', zh: '浅色', ja: 'ライト', de: 'Hell', ru: 'Светлая', it: 'Chiaro', fr: 'Clair', pt: 'Claro', ko: '라이트', ar: 'فاتح', hi: 'लाइट' },
  Dark: { es: 'Oscuro', zh: '深色', ja: 'ダーク', de: 'Dunkel', ru: 'Тёмная', it: 'Scuro', fr: 'Sombre', pt: 'Escuro', ko: '다크', ar: 'داكن', hi: 'डार्क' },

  // ---- My area: tab bar ----
  Profile: { es: 'Perfil', zh: '个人资料', ja: 'プロフィール', de: 'Profil', ru: 'Профиль', it: 'Profilo', fr: 'Profil', pt: 'Perfil', ko: '프로필', ar: 'الملف الشخصي', hi: 'प्रोफ़ाइल' },
  Expert: { es: 'Experto', zh: '专家', ja: '専門家', de: 'Experte', ru: 'Эксперт', it: 'Esperto', fr: 'Expert', pt: 'Especialista', ko: '전문가', ar: 'خبير', hi: 'विशेषज्ञ' },
  'Get started': { es: 'Comenzar', zh: '开始', ja: 'はじめる', de: 'Loslegen', ru: 'Начать', it: 'Inizia', fr: 'Commencer', pt: 'Começar', ko: '시작하기', ar: 'ابدأ', hi: 'शुरू करें' },
  'Voting & reviews': { es: 'Votaciones y revisiones', zh: '投票与评审', ja: '投票とレビュー', de: 'Abstimmungen & Prüfungen', ru: 'Голосования и обзоры', it: 'Votazioni e revisioni', fr: 'Votes et évaluations', pt: 'Votações e avaliações', ko: '투표 및 검토', ar: 'التصويت والمراجعات', hi: 'मतदान और समीक्षाएँ' },
  'My proposals': { es: 'Mis propuestas', zh: '我的提案', ja: '私の提案', de: 'Meine Anträge', ru: 'Мои предложения', it: 'Le mie proposte', fr: 'Mes propositions', pt: 'Minhas propostas', ko: '내 제안', ar: 'مقترحاتي', hi: 'मेरे प्रस्ताव' },
  Messages: { es: 'Mensajes', zh: '消息', ja: 'メッセージ', de: 'Nachrichten', ru: 'Сообщения', it: 'Messaggi', fr: 'Messages', pt: 'Mensagens', ko: '메시지', ar: 'الرسائل', hi: 'संदेश' },
  Actions: { es: 'Acciones', zh: '操作', ja: 'アクション', de: 'Aktionen', ru: 'Действия', it: 'Azioni', fr: 'Actions', pt: 'Ações', ko: '작업', ar: 'الإجراءات', hi: 'कार्रवाइयाँ' },
  'Round control': { es: 'Control de rondas', zh: '轮次控制', ja: 'ラウンド管理', de: 'Rundensteuerung', ru: 'Управление раундом', it: 'Controllo round', fr: 'Contrôle des tours', pt: 'Controle de rodadas', ko: '라운드 제어', ar: 'التحكم في الجولة', hi: 'राउंड नियंत्रण' },
  Rewards: { es: 'Recompensas', zh: '奖励', ja: '報酬', de: 'Belohnungen', ru: 'Награды', it: 'Ricompense', fr: 'Récompenses', pt: 'Recompensas', ko: '보상', ar: 'المكافآت', hi: 'पुरस्कार' },
  Applications: { es: 'Solicitudes', zh: '申请', ja: '申請', de: 'Bewerbungen', ru: 'Заявки', it: 'Candidature', fr: 'Candidatures', pt: 'Inscrições', ko: '신청', ar: 'الطلبات', hi: 'आवेदन' },

  // ---- Treasury tab ----
  Overview: { es: 'Resumen', zh: '概览', ja: '概要', de: 'Übersicht', ru: 'Обзор', it: 'Panoramica', fr: 'Aperçu', pt: 'Visão geral', ko: '개요', ar: 'نظرة عامة', hi: 'अवलोकन' },
  Transactions: { es: 'Transacciones', zh: '交易', ja: 'トランザクション', de: 'Transaktionen', ru: 'Транзакции', it: 'Transazioni', fr: 'Transactions', pt: 'Transações', ko: '거래', ar: 'المعاملات', hi: 'लेन-देन' },
  'Treasury multisig setup': { es: 'Configuración del multisig de tesorería', zh: '金库多签设置', ja: 'トレジャリーのマルチシグ設定', de: 'Treasury-Multisig-Einrichtung', ru: 'Настройка мультиподписи казначейства', it: 'Configurazione multisig della tesoreria', fr: 'Configuration multisig de la trésorerie', pt: 'Configuração do multisig da tesouraria', ko: '재무 멀티시그 설정', ar: 'إعداد التوقيع المتعدد للخزينة', hi: 'कोष मल्टीसिग सेटअप' },
  "The DAO's 3-of-5 multisig holds the budget; a low-balance hot wallet pays tx fees. Budgets: rewards, operations, and one per funding round.": { es: 'El multisig 3 de 5 de la DAO custodia el presupuesto; una hot wallet con saldo bajo paga las comisiones. Presupuestos: recompensas, operaciones y uno por ronda de financiación.', zh: 'DAO 的 3/5 多签持有预算；一个低余额热钱包支付交易手续费。预算：奖励、运营，以及每个资助轮次一个。', ja: 'DAO の 3-of-5 マルチシグが予算を保有し、低残高のホットウォレットが取引手数料を支払います。予算：報酬、運営、資金ラウンドごとに 1 つ。', de: 'Das 3-von-5-Multisig der DAO hält das Budget; eine Hot Wallet mit niedrigem Guthaben zahlt die Tx-Gebühren. Budgets: Belohnungen, Betrieb und eines pro Förderrunde.', ru: 'Мультиподпись DAO 3 из 5 хранит бюджет; горячий кошелёк с малым балансом оплачивает комиссии. Бюджеты: награды, операции и по одному на раунд финансирования.', it: 'Il multisig 3 su 5 della DAO custodisce il budget; un hot wallet a basso saldo paga le commissioni. Budget: ricompense, operazioni e uno per round di finanziamento.', fr: 'Le multisig 3 sur 5 de la DAO détient le budget ; un hot wallet à faible solde paie les frais de transaction. Budgets : récompenses, opérations et un par tour de financement.', pt: 'O multisig 3 de 5 da DAO guarda o orçamento; uma hot wallet de saldo baixo paga as taxas. Orçamentos: recompensas, operações e um por rodada de financiamento.', ko: 'DAO의 3-of-5 멀티시그가 예산을 보유하며, 잔액이 적은 핫 월렛이 거래 수수료를 지불합니다. 예산: 보상, 운영, 그리고 자금 라운드당 하나.', ar: 'يحتفظ التوقيع المتعدد 3 من 5 الخاص بالـ DAO بالميزانية؛ وتدفع محفظة ساخنة منخفضة الرصيد رسوم المعاملات. الميزانيات: المكافآت والعمليات وواحدة لكل جولة تمويل.', hi: 'DAO का 3-में-से-5 मल्टीसिग बजट रखता है; कम-शेष हॉट वॉलेट लेन-देन शुल्क चुकाता है। बजट: पुरस्कार, संचालन, और प्रत्येक वित्तपोषण राउंड के लिए एक।' },

  // ---- Rounds tab ----
  'Round stage:': { es: 'Etapa de la ronda:', zh: '轮次阶段：', ja: 'ラウンドの段階：', de: 'Rundenphase:', ru: 'Этап раунда:', it: 'Fase del round:', fr: 'Étape du tour :', pt: 'Etapa da rodada:', ko: '라운드 단계:', ar: 'مرحلة الجولة:', hi: 'राउंड चरण:' },
  Proposals: { es: 'Propuestas', zh: '提案', ja: '提案', de: 'Anträge', ru: 'Предложения', it: 'Proposte', fr: 'Propositions', pt: 'Propostas', ko: '제안', ar: 'المقترحات', hi: 'प्रस्ताव' },
  Categories: { es: 'Categorías', zh: '类别', ja: 'カテゴリ', de: 'Kategorien', ru: 'Категории', it: 'Categorie', fr: 'Catégories', pt: 'Categorias', ko: '카테고리', ar: 'الفئات', hi: 'श्रेणियाँ' },
  Tally: { es: 'Recuento', zh: '计票', ja: '集計', de: 'Auszählung', ru: 'Подсчёт', it: 'Conteggio', fr: 'Décompte', pt: 'Apuração', ko: '집계', ar: 'الفرز', hi: 'मतगणना' },
  'Voting Result': { es: 'Resultado de la votación', zh: '投票结果', ja: '投票結果', de: 'Abstimmungsergebnis', ru: 'Результат голосования', it: 'Risultato della votazione', fr: 'Résultat du vote', pt: 'Resultado da votação', ko: '투표 결과', ar: 'نتيجة التصويت', hi: 'मतदान परिणाम' },
  'Schedule and Round Setup': { es: 'Calendario y configuración de la ronda', zh: '日程与轮次设置', ja: 'スケジュールとラウンド設定', de: 'Zeitplan und Rundeneinrichtung', ru: 'Расписание и настройка раунда', it: 'Programma e configurazione del round', fr: 'Calendrier et configuration du tour', pt: 'Cronograma e configuração da rodada', ko: '일정 및 라운드 설정', ar: 'الجدول وإعداد الجولة', hi: 'समय-सारणी और राउंड सेटअप' },
};

/** Translate an English source string into `lang`, falling back to the English text. */
export function translate(lang: LangCode, key: string): string {
  if (lang === 'en') return key;
  return T[key]?.[lang] ?? key;
}
