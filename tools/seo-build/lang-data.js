// lang-data.js — translations for the multilingual homepage (and future pages).
// English is the source; each key carries the translation per target language.
// Add a language by adding its code to LANGS + a value to each string.
'use strict';

const LANGS = [
  { code: 'es', name: 'Español',     dir: 'ltr', weSpeak: 'español' },
  { code: 'vi', name: 'Tiếng Việt',  dir: 'ltr', weSpeak: 'tiếng Việt' },
  { code: 'ar', name: 'العربية',     dir: 'rtl', weSpeak: 'العربية' },
  { code: 'hi', name: 'हिन्दी',       dir: 'ltr', weSpeak: 'हिन्दी' },
  { code: 'fr', name: 'Français',    dir: 'ltr', weSpeak: 'français' },
];

// t[key][langCode]
const T = {
  title: {
    es: 'Reparación de Electrodomésticos · TN Appliance Exchange',
    vi: 'Sửa Chữa Thiết Bị Gia Dụng · TN Appliance Exchange',
    ar: 'إصلاح الأجهزة المنزلية · TN Appliance Exchange',
    hi: 'उपकरण मरम्मत · TN Appliance Exchange',
    fr: 'Réparation d’Électroménagers · TN Appliance Exchange',
  },
  desc: {
    es: 'Reparación honesta de electrodomésticos en Tennessee y Louisiana. Diagnóstico por video de $50, acreditado a tu reparación. Hablamos español. 🐜',
    vi: 'Sửa chữa thiết bị gia dụng trung thực ở Tennessee và Louisiana. Chẩn đoán qua video $50, được trừ vào tiền sửa. Chúng tôi nói tiếng Việt. 🐜',
    ar: 'إصلاح صادق للأجهزة المنزلية في تينيسي ولويزيانا. تشخيص بالفيديو مقابل 50 دولاراً، يُحتسب من قيمة الإصلاح. نتحدث العربية. 🐜',
    hi: 'टेनेसी और लुइसियाना में ईमानदार उपकरण मरम्मत। $50 वीडियो डायग्नोसिस, आपकी मरम्मत में समायोजित। हम हिन्दी बोलते हैं। 🐜',
    fr: 'Réparation honnête d’électroménagers au Tennessee et en Louisiane. Diagnostic vidéo à 50 $, crédité sur votre réparation. Nous parlons français. 🐜',
  },
  h1pre: {
    es: 'Deja de adivinar.', vi: 'Đừng đoán nữa.', ar: 'توقّف عن التخمين.', hi: 'अनुमान लगाना बंद करें।', fr: 'Arrêtez de deviner.',
  },
  h1acc: {
    es: 'Pregúntale a un técnico.', vi: 'Hỏi một kỹ thuật viên.', ar: 'اسأل فنيّاً.', hi: 'किसी तकनीशियन से पूछें।', fr: 'Demandez à un technicien.',
  },
  lede: {
    es: 'Reparación honesta de electrodomésticos en Tennessee y Louisiana. Dile a Ant qué pasa con tu aparato — nosotros nos encargamos del resto.',
    vi: 'Sửa chữa thiết bị gia dụng trung thực ở Tennessee và Louisiana. Hãy nói với Ant thiết bị của bạn bị gì — chúng tôi lo phần còn lại.',
    ar: 'إصلاح صادق للأجهزة المنزلية في تينيسي ولويزيانا. أخبر «آنت» بما يحدث لجهازك — ونحن نتولّى الباقي.',
    hi: 'टेनेसी और लुइसियाना में ईमानदार उपकरण मरम्मत। Ant को बताएं कि आपके उपकरण में क्या समस्या है — बाकी हम संभाल लेंगे।',
    fr: 'Réparation honnête d’électroménagers au Tennessee et en Louisiane. Dites à Ant ce qui ne va pas — on s’occupe du reste.',
  },
  ledeBold: {
    es: 'Y sí, hablamos español.', vi: 'Và vâng, chúng tôi nói tiếng Việt.', ar: 'ونعم، نحن نتحدث العربية.', hi: 'और हाँ, हम हिन्दी बोलते हैं।', fr: 'Et oui, nous parlons français.',
  },
  cta1: {
    es: '🐜 Empezar mi Revisión Rápida — $50', vi: '🐜 Bắt đầu Kiểm Tra Nhanh — $50', ar: '🐜 ابدأ فحصي السريع — 50$', hi: '🐜 मेरी क्विक चेक शुरू करें — $50', fr: '🐜 Commencer mon Diagnostic Rapide — 50 $',
  },
  cta2: {
    es: '📞 Llamar (866) 268-0111', vi: '📞 Gọi (866) 268-0111', ar: '📞 اتصل (866) 268-0111', hi: '📞 कॉल करें (866) 268-0111', fr: '📞 Appeler (866) 268-0111',
  },
  trust1: { es: '⭐ <b>4.5</b> · más de <b>1,000 reseñas</b>', vi: '⭐ <b>4.5</b> · hơn <b>1,000 đánh giá</b>', ar: '⭐ <b>4.5</b> · أكثر من <b>1,000 تقييم</b>', hi: '⭐ <b>4.5</b> · <b>1,000+ समीक्षाएं</b>', fr: '⭐ <b>4.5</b> · plus de <b>1,000 avis</b>' },
  trust2: { es: '<b>25 años</b> de experiencia', vi: '<b>25 năm</b> kinh nghiệm', ar: '<b>25 عاماً</b> من الخبرة', hi: '<b>25 साल</b> का अनुभव', fr: '<b>25 ans</b> d’expérience' },
  trust3: { es: 'Familiar · TN &amp; LA', vi: 'Gia đình · TN &amp; LA', ar: 'عمل عائلي · TN &amp; LA', hi: 'पारिवारिक · TN &amp; LA', fr: 'Entreprise familiale · TN &amp; LA' },
  h2how: { es: 'Cómo funciona', vi: 'Cách hoạt động', ar: 'كيف يعمل', hi: 'यह कैसे काम करता है', fr: 'Comment ça marche' },
  s1t: { es: 'Cuéntale a Ant qué pasa.', vi: 'Nói với Ant vấn đề là gì.', ar: 'أخبر «آنت» بالمشكلة.', hi: 'Ant को समस्या बताएं।', fr: 'Dites à Ant le problème.' },
  s1p: { es: 'Por chat o por teléfono — describe el problema con tu lavadora, secadora, refrigerador, lavavajillas u horno.', vi: 'Qua trò chuyện hoặc điện thoại — mô tả vấn đề máy giặt, máy sấy, tủ lạnh, máy rửa chén hoặc lò của bạn.', ar: 'عبر الدردشة أو الهاتف — صِف مشكلة غسالتك أو مجففك أو ثلاجتك أو غسالة الصحون أو الفرن.', hi: 'चैट या फ़ोन से — अपने वॉशर, ड्रायर, फ्रिज, डिशवॉशर या ओवन की समस्या बताएं।', fr: 'Par chat ou téléphone — décrivez le problème de votre laveuse, sécheuse, réfrigérateur, lave-vaisselle ou four.' },
  s2t: { es: 'Envía un video y una foto del número de modelo.', vi: 'Gửi video và ảnh số model.', ar: 'أرسل فيديو وصورة لرقم الطراز.', hi: 'एक वीडियो और मॉडल नंबर की फोटो भेजें।', fr: 'Envoyez une vidéo et une photo du numéro de modèle.' },
  s2p: { es: 'Un video de 10 segundos nos dice más que cualquier otra cosa.', vi: 'Một video 10 giây cho chúng tôi biết nhiều hơn bất cứ điều gì.', ar: 'فيديو مدته 10 ثوانٍ يخبرنا أكثر من أي شيء آخر.', hi: '10 सेकंड का वीडियो हमें सबसे ज़्यादा जानकारी देता है।', fr: 'Une vidéo de 10 secondes nous en dit plus que tout le reste.' },
  s3t: { es: 'Un técnico real revisa tu caso.', vi: 'Một kỹ thuật viên thật xem xét trường hợp của bạn.', ar: 'فنيّ حقيقي يراجع حالتك.', hi: 'एक असली तकनीशियन आपका मामला देखता है।', fr: 'Un vrai technicien examine votre cas.' },
  s3p: { es: 'Recibes un diagnóstico honesto y tus opciones en un par de horas — no días de espera.', vi: 'Bạn nhận được chẩn đoán trung thực và các lựa chọn trong vài giờ — không phải chờ nhiều ngày.', ar: 'تحصل على تشخيص صادق وخياراتك خلال ساعتين — وليس أياماً من الانتظار.', hi: 'कुछ ही घंटों में आपको ईमानदार निदान और विकल्प मिलते हैं — दिनों का इंतज़ार नहीं।', fr: 'Vous recevez un diagnostic honnête et vos options en quelques heures — pas des jours d’attente.' },
  s4t: { es: 'Tú decides — nosotros te programamos.', vi: 'Bạn quyết định — chúng tôi sắp lịch.', ar: 'أنت تقرّر — ونحن نحدّد الموعد.', hi: 'आप तय करें — हम शेड्यूल करते हैं।', fr: 'Vous décidez — on planifie.' },
  s4p: { es: 'Elige tu opción y nos dices cuándo estás disponible; nosotros enviamos al técnico en un día que te convenga.', vi: 'Chọn lựa chọn của bạn và cho biết khi nào bạn rảnh; chúng tôi cử kỹ thuật viên vào ngày phù hợp với bạn.', ar: 'اختر خيارك وأخبرنا بأوقات توفّرك؛ نرسل الفنيّ في يوم يناسبك.', hi: 'अपना विकल्प चुनें और बताएं कब आप उपलब्ध हैं; हम आपके सुविधाजनक दिन तकनीशियन भेजते हैं।', fr: 'Choisissez votre option et dites-nous vos disponibilités; on envoie le technicien un jour qui vous convient.' },
  h2why: { es: '¿Por qué la Revisión Rápida de $50?', vi: 'Tại sao Kiểm Tra Nhanh $50?', ar: 'لماذا الفحص السريع بـ 50$؟', hi: '$50 क्विक चेक क्यों?', fr: 'Pourquoi le Diagnostic Rapide à 50 $ ?' },
  w1: { es: '<b>Respuesta honesta en horas</b> — incluso si la respuesta es "no vale la pena arreglarlo".', vi: '<b>Câu trả lời trung thực trong vài giờ</b> — kể cả khi câu trả lời là "không đáng sửa".', ar: '<b>إجابة صادقة خلال ساعات</b> — حتى لو كانت الإجابة "لا يستحق الإصلاح".', hi: '<b>घंटों में ईमानदार जवाब</b> — भले ही जवाब हो "इसे ठीक कराना ठीक नहीं"।', fr: '<b>Une réponse honnête en quelques heures</b> — même si la réponse est « ça ne vaut pas la peine ».' },
  w2: { es: '<b>$50, no $125+</b> — la mayoría de los talleres cobran eso solo por presentarse. Y tu $50 se acredita a la reparación.', vi: '<b>$50, không phải $125+</b> — hầu hết các tiệm tính chừng đó chỉ để đến. Và $50 của bạn được trừ vào tiền sửa.', ar: '<b>50$ وليس 125$+</b> — معظم الورش تتقاضى ذلك لمجرد الحضور. و50$ تُحتسب من قيمة الإصلاح.', hi: '<b>$50, $125+ नहीं</b> — ज़्यादातर दुकानें सिर्फ़ आने के इतने लेती हैं। और आपके $50 मरम्मत में जुड़ते हैं।', fr: '<b>50 $, pas 125 $+</b> — la plupart des ateliers facturent ça juste pour se déplacer. Et vos 50 $ sont crédités sur la réparation.' },
  w3: { es: '<b>Te decimos la verdad</b> — el precio exacto y la parte exacta, sin sorpresas.', vi: '<b>Chúng tôi nói thật</b> — giá chính xác và bộ phận chính xác, không bất ngờ.', ar: '<b>نقول لك الحقيقة</b> — السعر الدقيق والقطعة الدقيقة، دون مفاجآت.', hi: '<b>हम सच बताते हैं</b> — सही कीमत और सही पुर्ज़ा, कोई आश्चर्य नहीं।', fr: '<b>On vous dit la vérité</b> — le prix exact et la pièce exacte, sans surprise.' },
  w4: {
    es: '<b>Ant te atiende en español</b> — escribe o habla en tu idioma; nosotros te entendemos perfectamente.',
    vi: '<b>Ant phục vụ bạn bằng tiếng Việt</b> — viết hoặc nói bằng ngôn ngữ của bạn; chúng tôi hiểu hoàn toàn.',
    ar: '<b>«آنت» يخدمك بالعربية</b> — اكتب أو تحدّث بلغتك؛ نحن نفهمك تماماً.',
    hi: '<b>Ant आपकी सेवा हिन्दी में करता है</b> — अपनी भाषा में लिखें या बोलें; हम पूरी तरह समझते हैं।',
    fr: '<b>Ant vous sert en français</b> — écrivez ou parlez dans votre langue ; on vous comprend parfaitement.',
  },
  h2fix: { es: 'Reparamos', vi: 'Chúng tôi sửa', ar: 'نحن نُصلح', hi: 'हम मरम्मत करते हैं', fr: 'Nous réparons' },
  aWasher: { es: '🌀 Lavadoras', vi: '🌀 Máy giặt', ar: '🌀 الغسالات', hi: '🌀 वॉशर', fr: '🌀 Laveuses' },
  aDryer: { es: '🔥 Secadoras', vi: '🔥 Máy sấy', ar: '🔥 المجففات', hi: '🔥 ड्रायर', fr: '🔥 Sécheuses' },
  aFridge: { es: '🧊 Refrigeradores', vi: '🧊 Tủ lạnh', ar: '🧊 الثلاجات', hi: '🧊 फ्रिज', fr: '🧊 Réfrigérateurs' },
  aDish: { es: '🍽️ Lavavajillas', vi: '🍽️ Máy rửa chén', ar: '🍽️ غسالات الصحون', hi: '🍽️ डिशवॉशर', fr: '🍽️ Lave-vaisselle' },
  aStove: { es: '♨️ Estufas / Hornos', vi: '♨️ Bếp / Lò', ar: '♨️ المواقد / الأفران', hi: '♨️ स्टोव / ओवन', fr: '♨️ Cuisinières / Fours' },
  aFreezer: { es: '❄️ Congeladores', vi: '❄️ Tủ đông', ar: '❄️ المجمّدات', hi: '❄️ फ्रीज़र', fr: '❄️ Congélateurs' },
  foot: {
    es: 'TN Appliance Exchange LLC · Sirviendo el centro de Tennessee y el sureste de Louisiana',
    vi: 'TN Appliance Exchange LLC · Phục vụ miền trung Tennessee và đông nam Louisiana',
    ar: 'TN Appliance Exchange LLC · نخدم وسط تينيسي وجنوب شرق لويزيانا',
    hi: 'TN Appliance Exchange LLC · मध्य टेनेसी और दक्षिण-पूर्व लुइसियाना की सेवा',
    fr: 'TN Appliance Exchange LLC · Au service du centre du Tennessee et du sud-est de la Louisiane',
  },
  footEn: { es: 'English version', vi: 'English version', ar: 'English version', hi: 'English version', fr: 'Version anglaise' },
};

module.exports = { LANGS, T };
