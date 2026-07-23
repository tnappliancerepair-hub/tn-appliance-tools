#!/usr/bin/env node
// build-lang-homepages — regenerates the /es /vi /ar /hi /fr homepages so they
// match the new ChatGPT-simple English homepage (index.html) EXACTLY in layout,
// just translated. ONE template, five dictionaries — so a design change to the
// English page is re-applied to every language by editing the template here and
// re-running. The conversion funnel (hero ask, chips, "what we fix", big CTA)
// carries ?lang=<code> so the customer stays in-language into appliance-ai.html.
//
//   node tools/build-lang-homepages.js   -> writes es/index.html, vi/…, ar/…, hi/…, fr/…
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ── Translation dictionaries ──────────────────────────────────────────────────
// Keep proper nouns in place: brand "TN Appliance Exchange", crew names, city +
// appliance-brand names, phone numbers. Everything a customer READS is translated.
const T = {
  es: {
    name: 'Español', dir: 'ltr',
    title: 'Reparación de Electrodomésticos en Nashville y Louisiana — El Mismo Día, 4.5★ · +1,000 Reseñas | TN Appliance Exchange',
    desc: '¿Electrodoméstico dañado? Dile a Ant qué pasa — un técnico local real te da una respuesta honesta y 4 opciones claras, el mismo día. Empresa familiar desde 2012. Centro de TN + Louisiana. Te contestamos de inmediato.',
    ogTitle: 'TN Appliance Exchange — Reparación honesta, guiada por técnicos',
    navTag: 'Deja de adivinar. Pregúntale a un técnico.', pill: 'Ant está en línea',
    trustReviews: 'reseñas de Google', trustFamily: 'Empresa familiar desde', trustSameday: 'El mismo día',
    h1: '¿Qué le pasa a tu electrodoméstico?',
    heroSub: 'Dile a Ant — un técnico local real te da una <strong>respuesta honesta, el mismo día.</strong> Sin call center, sin adivinanzas.',
    askPh: 'Escríbelo aquí — como “mi secadora no calienta”', startBtn: 'Empezar →',
    chips: ['🌀 Lavadora', '🔥 Secadora', '🧊 Refrigerador', '🍽️ Lavavajillas', '🍳 Estufa / Horno'],
    ccFine: 'Un técnico real lo revisa, normalmente en unas horas. Al empezar aceptas recibir mensajes de texto sobre tu reparación.',
    ccSms: 'Términos SMS', ccPriv: 'Privacidad', ccCall: 'O llama al',
    badges: ['Con licencia y seguro', 'Técnicos con antecedentes verificados', 'Familiar, guiada por técnicos', 'La tarifa de diagnóstico se acredita a tu reparación', 'Centro de TN + Louisiana'],
    hiwLabel: 'Cómo funciona', hiwH2: 'Tres pasos para una respuesta real',
    steps: [
      ['Dile a Ant qué pasa', 'Escríbelo o toca tu electrodoméstico arriba. Envía un video corto y una foto de la etiqueta con el número de modelo — eso es todo lo que un técnico necesita.'],
      ['Un técnico real lo revisa', 'No es un bot ni un call center — un técnico real mira tu máquina, normalmente en unas horas, y descubre exactamente qué está pasando.'],
      ['Recibes cuatro opciones honestas', 'Tu Informe de Decisión del Técnico muestra el precio real de cuatro maneras. Elige lo que te convenga — instala tú la pieza o la instalamos nosotros. Tu tarifa de diagnóstico se acredita a la reparación.'],
    ],
    tdrLabel: 'El Informe de Decisión del Técnico', tdrH2: 'Cuatro opciones, precio real, tú decides',
    tdrProse: 'Cada reparación comienza con un técnico real revisando tu modelo y los síntomas. Siempre ves el panorama completo y eliges — sin presión, sin un número misterioso “todo incluido” con el margen escondido adentro.',
    tdrCards: [
      ['Pieza OEM únicamente', 'Conseguimos la pieza OEM exacta y te la enviamos. Tú la instalas. Ideal para quienes reparan por su cuenta y quieren un ajuste garantizado.'],
      ['Pieza económica únicamente', 'Una pieza compatible verificada a menor precio, enviada a tu puerta. Tú la instalas. Perfecta cuando el ajuste es sencillo.'],
      ['Pieza OEM + la instalamos', 'Conseguimos la pieza OEM y nuestro técnico la instala. Mejor cuando el ajuste es crítico o el acceso es complicado.'],
      ['Pieza económica + la instalamos', 'Conseguimos una pieza equivalente y la instalamos — el equilibrio entre costo y comodidad.'],
    ],
    crewLabel: 'Conoce al equipo', crewH2: 'Las personas reales que reparan tu electrodoméstico',
    crewProse: 'Sin call center. Sin guion de franquicia. TN Appliance Exchange es un taller familiar que repara electrodomésticos en el centro de Tennessee y el sur de Louisiana desde 2012.',
    crew: ['Dueño y fundador, con las herramientas en mano desde 2012.', 'Sur de Nashville y todo el centro de TN.', 'Clarksville y el centro de TN, con el taller desde 2020.', '3ª generación — hijo de Teddy, ambas costas de LA.', 'Más de 40 años en electrodomésticos, por toda Louisiana.'],
    videoCap: 'Teddy en el taller de TN Appliance — trabajo de reparación real, respuestas honestas, sin adivinanzas.',
    fixLabel: 'Lo que reparamos', fixH2: 'Un equipo, todos los electrodomésticos',
    fix: ['Lavadoras', 'Secadoras', 'Refrigeradores', 'Lavavajillas', 'Estufas y Hornos', 'Limpieza de Ductos de Secadora'],
    priceLabel: 'Precio justo y fijo', priceH2: 'Números reales, sin misterio',
    priceProse: 'Cotizamos un <strong>precio fijo de mano de obra por trabajo</strong> — luego la pieza exacta a nuestro costo real más un margen justo. Aquí está nuestra mano de obra fija junto a lo que cobra el taller promedio “todo incluido” (piezas <em>y</em> mano de obra) por trabajos comunes.',
    priceHead: ['Reparación común', 'Nuestra mano de obra fija', 'Taller promedio, todo incluido'],
    priceRows: [['Resistencia de secadora', '$120', '~$230'], ['Bomba de desagüe de lavadora', '$130', '~$210'], ['Control / termostato de refrigerador', '$170', '~$290'], ['Bomba / válvula de lavavajillas', '$140', '~$250'], ['Encendedor / resistencia de horno', '$130', '~$240']],
    priceCredit: '<b>Tu tarifa de diagnóstico nunca se desperdicia.</b> Cada dólar de la Revisión Rápida ($50) o del diagnóstico a domicilio ($100) se acredita directamente a la mano de obra de tu reparación si sigues adelante. Pagas una sola vez — nunca por un diagnóstico <em>y</em> una reparación.',
    revLabel: 'Lo que dicen los clientes', revH2: 'Calificados 4.5★ por vecinos reales',
    revCount: 'reseñas verificadas de Google · Centro de TN y Louisiana', revAll: 'Lee todas nuestras reseñas de Google →',
    areaLabel: 'Dónde damos servicio', areaH2: 'Centro de Tennessee + Louisiana',
    brandLabel: 'Marcas que reparamos', brandH2: 'Todas las marcas principales',
    faqLabel: 'Preguntas frecuentes', faqH2: 'La gente también pregunta',
    faq: [
      ['¿Qué tan rápido recibo un diagnóstico?', 'Dile a Ant qué pasa a cualquier hora — un técnico real revisa tu video y número de modelo, normalmente en unas horas, y arma tu Informe de Decisión del Técnico con 4 opciones.'],
      ['¿Pago por el diagnóstico Y por la reparación?', 'No. Tu Revisión Rápida de $50 o el diagnóstico a domicilio de $100 se acredita directamente a la mano de obra si sigues adelante. Pagas una sola vez.'],
      ['¿Venden electrodomésticos usados?', 'No — somos un taller de reparación, no una tienda de usados. Reparamos lo que tienes y te damos una respuesta honesta de reparar o reemplazar.'],
      ['¿Qué áreas cubren?', 'Centro de Tennessee (Nashville, Murfreesboro, Antioch, Clarksville y alrededores) y Louisiana (New Orleans, Baton Rouge, Hammond y ambas costas).'],
    ],
    ctaLabel: 'Empezar', ctaH2: 'Dile a Ant qué pasa — recibe una respuesta real hoy',
    ctaP: 'Envía un video corto y tu número de modelo, y un técnico real armará tu Informe de Decisión del Técnico. Sin música de espera, sin adivinanzas, sin compromiso hasta que veas tus opciones.',
    ctaPrimary: '🐜 Empezar con Ant', ctaSecondary: '📞 Llamar 615-280-2949',
    footLinks: ['Cómo funciona', '¿Reparar o reemplazar?', 'Appliance Ant', 'Reparación de Secadora', 'Reparación de Refrigerador', 'Privacidad', 'Términos SMS'],
    footFine: 'TN Appliance Exchange · 615-280-2949 (TN) · 504-355-9111 (LA) · Familiar, guiada por técnicos desde 2012',
    jsPh: { Washer: 'ej. no desagua o no centrifuga…', Dryer: 'ej. no calienta…', Refrigerator: 'ej. no enfría…', Dishwasher: 'ej. no desagua…', Oven: 'ej. no calienta…' },
  },

  fr: {
    name: 'Français', dir: 'ltr',
    title: 'Réparation d’Électroménagers à Nashville et en Louisiane — Le Jour Même, 4.5★ · +1 000 Avis | TN Appliance Exchange',
    desc: 'Appareil en panne ? Dites à Ant ce qui ne va pas — un vrai technicien local vous donne une réponse honnête et 4 options claires, le jour même. Entreprise familiale depuis 2012. Centre du TN + Louisiane. On vous répond tout de suite.',
    ogTitle: 'TN Appliance Exchange — Réparation honnête, menée par des techniciens',
    navTag: 'Arrêtez de deviner. Demandez à un technicien.', pill: 'Ant est en ligne',
    trustReviews: 'avis Google', trustFamily: 'Entreprise familiale depuis', trustSameday: 'Le jour même',
    h1: 'Qu’est-ce qui ne va pas avec votre appareil ?',
    heroSub: 'Dites-le à Ant — un vrai technicien local vous donne une <strong>réponse honnête, le jour même.</strong> Pas de centre d’appels, pas de devinettes.',
    askPh: 'Écrivez-le ici — par ex. « mon sèche-linge ne chauffe plus »', startBtn: 'Commencer →',
    chips: ['🌀 Lave-linge', '🔥 Sèche-linge', '🧊 Réfrigérateur', '🍽️ Lave-vaisselle', '🍳 Cuisinière / Four'],
    ccFine: 'Un vrai technicien l’examine, généralement en quelques heures. En commençant, vous acceptez de recevoir des SMS au sujet de votre réparation.',
    ccSms: 'Conditions SMS', ccPriv: 'Confidentialité', ccCall: 'Ou appelez le',
    badges: ['Agréé et assuré', 'Techniciens avec antécédents vérifiés', 'Familiale, menée par des techniciens', 'Les frais de diagnostic sont crédités à votre réparation', 'Centre du TN + Louisiane'],
    hiwLabel: 'Comment ça marche', hiwH2: 'Trois étapes vers une vraie réponse',
    steps: [
      ['Dites à Ant ce qui ne va pas', 'Écrivez-le ou touchez votre appareil ci-dessus. Envoyez une courte vidéo et une photo de l’étiquette du numéro de modèle — c’est tout ce qu’un technicien a besoin.'],
      ['Un vrai technicien l’examine', 'Ni un robot ni un centre d’appels — un vrai technicien regarde votre appareil, généralement en quelques heures, et détermine exactement ce qui se passe.'],
      ['Vous recevez quatre options honnêtes', 'Votre Rapport de Décision du Technicien présente le vrai prix de quatre façons. Choisissez ce qui vous convient — posez la pièce vous-même ou nous l’installons. Vos frais de diagnostic sont crédités à la réparation.'],
    ],
    tdrLabel: 'Le Rapport de Décision du Technicien', tdrH2: 'Quatre options, prix réel, à vous de choisir',
    tdrProse: 'Chaque réparation commence par un vrai technicien qui examine votre modèle et les symptômes. Vous voyez toujours l’ensemble et vous choisissez — sans pression, sans prix mystérieux « tout compris » avec la marge cachée à l’intérieur.',
    tdrCards: [
      ['Pièce OEM seulement', 'Nous trouvons la pièce OEM exacte et vous l’expédions. Vous l’installez. Idéal pour les bricoleurs confiants qui veulent un ajustement garanti.'],
      ['Pièce économique seulement', 'Une pièce compatible vérifiée à prix réduit, livrée chez vous. Vous l’installez. Parfait quand la pose est simple.'],
      ['Pièce OEM + nous l’installons', 'Nous trouvons la pièce OEM et notre technicien l’installe. Mieux quand l’ajustement est critique ou l’accès difficile.'],
      ['Pièce économique + nous l’installons', 'Nous trouvons une pièce équivalente et l’installons — l’équilibre entre coût et commodité.'],
    ],
    crewLabel: 'Rencontrez l’équipe', crewH2: 'Les vraies personnes qui réparent votre appareil',
    crewProse: 'Pas de centre d’appels. Pas de script de franchise. TN Appliance Exchange est un atelier familial qui répare les électroménagers dans le centre du Tennessee et le sud de la Louisiane depuis 2012.',
    crew: ['Propriétaire et fondateur, sur le terrain depuis 2012.', 'Sud de Nashville et tout le centre du TN.', 'Clarksville et le centre du TN, avec l’atelier depuis 2020.', '3ᵉ génération — le fils de Teddy, les deux rives de la LA.', 'Plus de 40 ans sur les appareils, partout en Louisiane.'],
    videoCap: 'Teddy à l’atelier TN Appliance — du vrai travail de réparation, des réponses honnêtes, aucune devinette.',
    fixLabel: 'Ce que nous réparons', fixH2: 'Une équipe, tous les appareils',
    fix: ['Lave-linge', 'Sèche-linge', 'Réfrigérateurs', 'Lave-vaisselle', 'Cuisinières et Fours', 'Nettoyage de Conduit de Sécheuse'],
    priceLabel: 'Tarif juste et fixe', priceH2: 'Des chiffres réels, sans mystère',
    priceProse: 'Nous fixons un <strong>tarif de main-d’œuvre forfaitaire par travail</strong> — puis la pièce exacte à notre coût réel plus une marge juste. Voici notre main-d’œuvre forfaitaire à côté de ce que facture l’atelier moyen « tout compris » (pièces <em>et</em> main-d’œuvre) pour des travaux courants.',
    priceHead: ['Réparation courante', 'Notre main-d’œuvre forfaitaire', 'Atelier moyen, tout compris'],
    priceRows: [['Résistance de sèche-linge', '$120', '~$230'], ['Pompe de vidange de lave-linge', '$130', '~$210'], ['Commande / thermostat de réfrigérateur', '$170', '~$290'], ['Pompe / vanne de lave-vaisselle', '$140', '~$250'], ['Allumeur / résistance de four', '$130', '~$240']],
    priceCredit: '<b>Vos frais de diagnostic ne sont jamais perdus.</b> Chaque dollar du Contrôle Rapide (50 $) ou du diagnostic à domicile (100 $) est crédité directement à la main-d’œuvre de votre réparation si vous poursuivez. Vous payez une seule fois — jamais pour un diagnostic <em>et</em> une réparation.',
    revLabel: 'Ce que disent les clients', revH2: 'Notés 4.5★ par de vrais voisins',
    revCount: 'avis Google vérifiés · Centre du TN et Louisiane', revAll: 'Lisez tous nos avis Google →',
    areaLabel: 'Où nous intervenons', areaH2: 'Centre du Tennessee + Louisiane',
    brandLabel: 'Marques que nous réparons', brandH2: 'Toutes les grandes marques',
    faqLabel: 'FAQ', faqH2: 'Les gens demandent aussi',
    faq: [
      ['En combien de temps ai-je un diagnostic ?', 'Dites à Ant ce qui ne va pas à tout moment — un vrai technicien examine votre vidéo et votre numéro de modèle, généralement en quelques heures, et bâtit votre Rapport de Décision du Technicien à 4 options.'],
      ['Est-ce que je paie le diagnostic ET la réparation ?', 'Non. Votre Contrôle Rapide de 50 $ ou votre diagnostic à domicile de 100 $ est crédité directement à la main-d’œuvre si vous poursuivez. Vous payez une seule fois.'],
      ['Vendez-vous des appareils d’occasion ?', 'Non — nous sommes un atelier de réparation, pas un magasin d’occasion. Nous réparons ce que vous avez et vous donnons une réponse honnête réparer ou remplacer.'],
      ['Quelles zones couvrez-vous ?', 'Le centre du Tennessee (Nashville, Murfreesboro, Antioch, Clarksville et environs) et la Louisiane (New Orleans, Baton Rouge, Hammond et les deux rives).'],
    ],
    ctaLabel: 'Commencer', ctaH2: 'Dites à Ant ce qui ne va pas — obtenez une vraie réponse aujourd’hui',
    ctaP: 'Envoyez une courte vidéo et votre numéro de modèle, et un vrai technicien bâtira votre Rapport de Décision du Technicien. Pas de musique d’attente, pas de devinettes, aucun engagement avant de voir vos options.',
    ctaPrimary: '🐜 Commencer avec Ant', ctaSecondary: '📞 Appeler le 615-280-2949',
    footLinks: ['Comment ça marche', 'Réparer ou remplacer ?', 'Appliance Ant', 'Réparation de Sèche-linge', 'Réparation de Réfrigérateur', 'Confidentialité', 'Conditions SMS'],
    footFine: 'TN Appliance Exchange · 615-280-2949 (TN) · 504-355-9111 (LA) · Familiale, menée par des techniciens depuis 2012',
    jsPh: { Washer: 'p. ex. ne vidange pas ou n’essore pas…', Dryer: 'p. ex. ne chauffe pas…', Refrigerator: 'p. ex. ne refroidit pas…', Dishwasher: 'p. ex. ne vidange pas…', Oven: 'p. ex. ne chauffe pas…' },
  },

  vi: {
    name: 'Tiếng Việt', dir: 'ltr',
    title: 'Sửa Thiết Bị Gia Dụng ở Nashville & Louisiana — Trong Ngày, 4.5★ · Hơn 1.000 Đánh Giá | TN Appliance Exchange',
    desc: 'Thiết bị bị hỏng? Hãy nói cho Ant biết vấn đề — một kỹ thuật viên địa phương thật sự sẽ cho bạn câu trả lời trung thực và 4 lựa chọn rõ ràng, ngay trong ngày. Doanh nghiệp gia đình từ 2012. Trung tâm TN + Louisiana. Chúng tôi nhắn lại ngay.',
    ogTitle: 'TN Appliance Exchange — Sửa chữa trung thực, do kỹ thuật viên dẫn dắt',
    navTag: 'Đừng đoán nữa. Hãy hỏi kỹ thuật viên.', pill: 'Ant đang trực tuyến',
    trustReviews: 'đánh giá Google', trustFamily: 'Doanh nghiệp gia đình từ', trustSameday: 'Trong ngày',
    h1: 'Thiết bị của bạn bị sao vậy?',
    heroSub: 'Hãy nói cho Ant — một kỹ thuật viên địa phương thật sự cho bạn <strong>câu trả lời trung thực, ngay trong ngày.</strong> Không tổng đài, không đoán mò.',
    askPh: 'Gõ vào đây — ví dụ “máy sấy không nóng”', startBtn: 'Bắt đầu →',
    chips: ['🌀 Máy giặt', '🔥 Máy sấy', '🧊 Tủ lạnh', '🍽️ Máy rửa chén', '🍳 Bếp / Lò'],
    ccFine: 'Một kỹ thuật viên thật sự sẽ xem, thường trong vài giờ. Khi bắt đầu, bạn đồng ý nhận tin nhắn về việc sửa chữa của mình.',
    ccSms: 'Điều khoản SMS', ccPriv: 'Quyền riêng tư', ccCall: 'Hoặc gọi',
    badges: ['Có giấy phép & bảo hiểm', 'Kỹ thuật viên đã kiểm tra lý lịch', 'Gia đình, do kỹ thuật viên dẫn dắt', 'Phí chẩn đoán được trừ vào tiền sửa', 'Trung tâm TN + Louisiana'],
    hiwLabel: 'Cách hoạt động', hiwH2: 'Ba bước để có câu trả lời thật',
    steps: [
      ['Nói cho Ant biết vấn đề', 'Gõ vào hoặc chạm vào thiết bị ở trên. Gửi một video ngắn và ảnh nhãn số model — đó là tất cả những gì kỹ thuật viên cần.'],
      ['Kỹ thuật viên thật sự xem xét', 'Không phải bot, không phải tổng đài — một kỹ thuật viên thật sự xem máy của bạn, thường trong vài giờ, và tìm ra chính xác vấn đề.'],
      ['Bạn nhận bốn lựa chọn trung thực', 'Báo Cáo Quyết Định của Kỹ Thuật Viên đưa ra giá thật theo bốn cách. Chọn cách phù hợp — tự lắp linh kiện, hoặc chúng tôi lắp. Phí chẩn đoán được trừ vào tiền sửa.'],
    ],
    tdrLabel: 'Báo Cáo Quyết Định của Kỹ Thuật Viên', tdrH2: 'Bốn lựa chọn, giá thật, bạn quyết định',
    tdrProse: 'Mỗi lần sửa đều bắt đầu bằng một kỹ thuật viên thật sự xem model và triệu chứng của bạn. Bạn luôn thấy toàn bộ bức tranh và tự chọn — không ép buộc, không có con số “trọn gói” bí ẩn giấu tiền lời bên trong.',
    tdrCards: [
      ['Chỉ linh kiện OEM', 'Chúng tôi tìm đúng linh kiện OEM và gửi đến bạn. Bạn tự lắp. Tốt nhất cho người tự sửa muốn lắp vừa khít bảo đảm.'],
      ['Chỉ linh kiện giá rẻ', 'Linh kiện tương thích đã kiểm tra với giá thấp hơn, giao tận nhà. Bạn tự lắp. Tuyệt vời khi việc lắp đơn giản.'],
      ['Linh kiện OEM + chúng tôi lắp', 'Chúng tôi tìm linh kiện OEM và kỹ thuật viên lắp đặt. Tốt nhất khi độ khít quan trọng hoặc khó tiếp cận.'],
      ['Linh kiện giá rẻ + chúng tôi lắp', 'Chúng tôi tìm linh kiện tương đương và lắp đặt — cân bằng giữa chi phí và tiện lợi.'],
    ],
    crewLabel: 'Gặp gỡ đội ngũ', crewH2: 'Những con người thật sửa thiết bị của bạn',
    crewProse: 'Không tổng đài. Không kịch bản nhượng quyền. TN Appliance Exchange là một tiệm sửa gia đình đã sửa thiết bị khắp trung tâm Tennessee và nam Louisiana từ năm 2012.',
    crew: ['Chủ & người sáng lập, cầm dụng cụ từ 2012.', 'Nam Nashville và khắp trung tâm TN.', 'Clarksville và trung tâm TN, gắn bó với tiệm từ 2020.', 'Thế hệ thứ 3 — con trai của Teddy, cả hai bờ LA.', 'Hơn 40 năm với thiết bị, khắp Louisiana.'],
    videoCap: 'Teddy tại tiệm TN Appliance — công việc sửa chữa thật, câu trả lời trung thực, không đoán mò.',
    fixLabel: 'Chúng tôi sửa gì', fixH2: 'Một đội ngũ, mọi thiết bị',
    fix: ['Máy giặt', 'Máy sấy', 'Tủ lạnh', 'Máy rửa chén', 'Bếp & Lò', 'Vệ Sinh Ống Thoát Máy Sấy'],
    priceLabel: 'Giá cố định, minh bạch', priceH2: 'Con số thật, không bí ẩn',
    priceProse: 'Chúng tôi báo <strong>giá nhân công cố định theo từng việc</strong> — rồi linh kiện đúng loại theo giá gốc thật cộng lời hợp lý. Đây là giá nhân công cố định của chúng tôi bên cạnh mức tiệm trung bình tính “trọn gói” (cả linh kiện <em>lẫn</em> nhân công) cho các việc thường gặp.',
    priceHead: ['Sửa chữa thường gặp', 'Nhân công cố định của chúng tôi', 'Tiệm trung bình, trọn gói'],
    priceRows: [['Điện trở máy sấy', '$120', '~$230'], ['Bơm xả máy giặt', '$130', '~$210'], ['Bo mạch / cảm biến nhiệt tủ lạnh', '$170', '~$290'], ['Bơm / van máy rửa chén', '$140', '~$250'], ['Bộ đánh lửa / điện trở lò', '$130', '~$240']],
    priceCredit: '<b>Phí chẩn đoán không bao giờ lãng phí.</b> Từng đồng của Kiểm Tra Nhanh ($50) hoặc chẩn đoán tại nhà ($100) được trừ thẳng vào tiền nhân công nếu bạn tiến hành. Bạn chỉ trả một lần — không bao giờ trả cho cả chẩn đoán <em>lẫn</em> sửa chữa.',
    revLabel: 'Khách hàng nói gì', revH2: 'Được hàng xóm thật đánh giá 4.5★',
    revCount: 'đánh giá Google đã xác minh · Trung tâm TN & Louisiana', revAll: 'Đọc tất cả đánh giá Google của chúng tôi →',
    areaLabel: 'Nơi chúng tôi phục vụ', areaH2: 'Trung tâm Tennessee + Louisiana',
    brandLabel: 'Các hãng chúng tôi sửa', brandH2: 'Mọi hãng lớn',
    faqLabel: 'Câu hỏi thường gặp', faqH2: 'Mọi người cũng hỏi',
    faq: [
      ['Tôi có chẩn đoán nhanh không?', 'Hãy nói cho Ant biết vấn đề bất cứ lúc nào — một kỹ thuật viên thật sự xem video và số model của bạn, thường trong vài giờ, và lập Báo Cáo Quyết Định 4 lựa chọn.'],
      ['Tôi có phải trả cho cả chẩn đoán VÀ sửa chữa không?', 'Không. Kiểm Tra Nhanh $50 hoặc chẩn đoán tại nhà $100 được trừ thẳng vào tiền nhân công nếu bạn tiến hành. Bạn chỉ trả một lần.'],
      ['Các bạn có bán thiết bị cũ không?', 'Không — chúng tôi là tiệm sửa, không phải cửa hàng đồ cũ. Chúng tôi sửa thứ bạn đang có và cho lời khuyên trung thực nên sửa hay thay.'],
      ['Các bạn phục vụ những khu vực nào?', 'Trung tâm Tennessee (Nashville, Murfreesboro, Antioch, Clarksville và vùng lân cận) và Louisiana (New Orleans, Baton Rouge, Hammond và cả hai bờ).'],
    ],
    ctaLabel: 'Bắt đầu', ctaH2: 'Nói cho Ant biết vấn đề — nhận câu trả lời thật hôm nay',
    ctaP: 'Gửi một video ngắn và số model, một kỹ thuật viên thật sự sẽ lập Báo Cáo Quyết Định cho bạn. Không nhạc chờ, không đoán mò, không ràng buộc cho đến khi bạn thấy các lựa chọn.',
    ctaPrimary: '🐜 Bắt đầu với Ant', ctaSecondary: '📞 Gọi 615-280-2949',
    footLinks: ['Cách hoạt động', 'Sửa hay thay?', 'Appliance Ant', 'Sửa Máy Sấy', 'Sửa Tủ Lạnh', 'Quyền riêng tư', 'Điều khoản SMS'],
    footFine: 'TN Appliance Exchange · 615-280-2949 (TN) · 504-355-9111 (LA) · Gia đình, do kỹ thuật viên dẫn dắt từ 2012',
    jsPh: { Washer: 'vd. không xả hoặc không vắt…', Dryer: 'vd. không nóng…', Refrigerator: 'vd. không lạnh…', Dishwasher: 'vd. không xả nước…', Oven: 'vd. không nóng lên…' },
  },

  hi: {
    name: 'हिन्दी', dir: 'ltr',
    title: 'नैशविल और लुइज़ियाना में उपकरण मरम्मत — उसी दिन, 4.5★ · 1,000+ समीक्षाएँ | TN Appliance Exchange',
    desc: 'उपकरण खराब? Ant को बताएँ क्या दिक्कत है — एक असली स्थानीय तकनीशियन आपको ईमानदार जवाब और 4 साफ़ विकल्प देता है, उसी दिन। 2012 से पारिवारिक व्यवसाय। मध्य TN + लुइज़ियाना। हम तुरंत जवाब देते हैं।',
    ogTitle: 'TN Appliance Exchange — ईमानदार, तकनीशियन-आधारित उपकरण मरम्मत',
    navTag: 'अंदाज़ा लगाना बंद करें। तकनीशियन से पूछें।', pill: 'Ant ऑनलाइन है',
    trustReviews: 'Google समीक्षाएँ', trustFamily: 'पारिवारिक व्यवसाय, स्थापित', trustSameday: 'उसी दिन',
    h1: 'आपके उपकरण में क्या दिक्कत है?',
    heroSub: 'Ant को बताएँ — एक असली स्थानीय तकनीशियन आपको <strong>ईमानदार जवाब देता है, उसी दिन।</strong> कोई कॉल सेंटर नहीं, कोई अंदाज़ा नहीं।',
    askPh: 'यहाँ लिखें — जैसे “मेरा ड्रायर गरम नहीं होता”', startBtn: 'शुरू करें →',
    chips: ['🌀 वॉशर', '🔥 ड्रायर', '🧊 रेफ्रिजरेटर', '🍽️ डिशवॉशर', '🍳 स्टोव / ओवन'],
    ccFine: 'एक असली तकनीशियन इसे देखता है, आमतौर पर कुछ घंटों में। शुरू करने पर आप अपनी मरम्मत के बारे में टेक्स्ट पाने के लिए सहमत होते हैं।',
    ccSms: 'SMS शर्तें', ccPriv: 'गोपनीयता', ccCall: 'या कॉल करें',
    badges: ['लाइसेंस प्राप्त और बीमाकृत', 'पृष्ठभूमि-जाँचे तकनीशियन', 'पारिवारिक, तकनीशियन-आधारित', 'निदान शुल्क आपकी मरम्मत में जुड़ जाता है', 'मध्य TN + लुइज़ियाना'],
    hiwLabel: 'यह कैसे काम करता है', hiwH2: 'असली जवाब तक तीन कदम',
    steps: [
      ['Ant को बताएँ क्या दिक्कत है', 'इसे लिखें या ऊपर अपना उपकरण चुनें। एक छोटा वीडियो और मॉडल-नंबर स्टिकर की फ़ोटो भेजें — तकनीशियन को बस इतना ही चाहिए।'],
      ['एक असली तकनीशियन इसे देखता है', 'न बॉट, न कॉल सेंटर — एक असली तकनीशियन आपकी मशीन देखता है, आमतौर पर कुछ घंटों में, और ठीक-ठीक पता लगाता है कि क्या हो रहा है।'],
      ['आपको चार ईमानदार विकल्प मिलते हैं', 'आपकी Technician Decision Report असली कीमत चार तरीकों से दिखाती है। जो सही लगे चुनें — पुर्ज़ा खुद लगाएँ, या हम लगाएँ। आपका निदान शुल्क मरम्मत में जुड़ जाता है।'],
    ],
    tdrLabel: 'Technician Decision Report', tdrH2: 'चार विकल्प, असली कीमत, आपका फ़ैसला',
    tdrProse: 'हर मरम्मत एक असली तकनीशियन द्वारा आपके मॉडल और लक्षण देखने से शुरू होती है। आप हमेशा पूरी तस्वीर देखते हैं और चुनते हैं — कोई दबाव नहीं, अंदर छिपे मुनाफ़े वाला कोई रहस्यमय “सब-मिलाकर” आँकड़ा नहीं।',
    tdrCards: [
      ['केवल OEM पुर्ज़ा', 'हम सही OEM पुर्ज़ा मंगाकर आपको भेजते हैं। आप लगाते हैं। उन लोगों के लिए बेहतरीन जो खुद ठीक करते हैं और गारंटीड फ़िट चाहते हैं।'],
      ['केवल किफ़ायती पुर्ज़ा', 'जाँचा हुआ संगत पुर्ज़ा कम कीमत पर, आपके दरवाज़े तक। आप लगाते हैं। जब फ़िट आसान हो तब शानदार।'],
      ['OEM पुर्ज़ा + हम लगाएँ', 'हम OEM पुर्ज़ा मंगाते हैं और हमारा तकनीशियन लगाता है। जब फ़िट अहम हो या पहुँच मुश्किल हो तब बेहतर।'],
      ['किफ़ायती पुर्ज़ा + हम लगाएँ', 'हम समकक्ष पुर्ज़ा मंगाकर लगाते हैं — लागत और सुविधा का संतुलन।'],
    ],
    crewLabel: 'टीम से मिलें', crewH2: 'आपका उपकरण ठीक करने वाले असली लोग',
    crewProse: 'कोई कॉल सेंटर नहीं। कोई फ़्रैंचाइज़ स्क्रिप्ट नहीं। TN Appliance Exchange एक पारिवारिक दुकान है जो 2012 से मध्य टेनेसी और दक्षिण लुइज़ियाना में उपकरण ठीक कर रही है।',
    crew: ['मालिक और संस्थापक, 2012 से औज़ारों के साथ।', 'दक्षिण नैशविल और पूरे मध्य TN में।', 'क्लार्क्सविल और मध्य TN, 2020 से दुकान के साथ।', 'तीसरी पीढ़ी — Teddy का बेटा, LA के दोनों किनारे।', '40+ साल उपकरणों पर, पूरे लुइज़ियाना में।'],
    videoCap: 'TN Appliance की दुकान पर Teddy — असली मरम्मत का काम, ईमानदार जवाब, कोई अंदाज़ा नहीं।',
    fixLabel: 'हम क्या ठीक करते हैं', fixH2: 'एक टीम, हर उपकरण',
    fix: ['वॉशर', 'ड्रायर', 'रेफ्रिजरेटर', 'डिशवॉशर', 'स्टोव और ओवन', 'ड्रायर वेंट सफ़ाई'],
    priceLabel: 'ईमानदार, तयशुदा कीमत', priceH2: 'असली आँकड़े, कोई रहस्य नहीं',
    priceProse: 'हम <strong>हर काम की तयशुदा मज़दूरी</strong> बताते हैं — फिर सही पुर्ज़ा हमारी असली लागत पर, साथ में उचित मुनाफ़ा। यहाँ हमारी तयशुदा मज़दूरी है, उसके बगल में औसत दुकान का “सब-मिलाकर” (पुर्ज़ा <em>और</em> मज़दूरी) आम कामों के लिए।',
    priceHead: ['आम मरम्मत', 'हमारी तयशुदा मज़दूरी', 'औसत दुकान, सब-मिलाकर'],
    priceRows: [['ड्रायर हीटिंग एलिमेंट', '$120', '~$230'], ['वॉशर ड्रेन पंप', '$130', '~$210'], ['फ्रिज कंट्रोल / थर्मोस्टेट', '$170', '~$290'], ['डिशवॉशर पंप / वाल्व', '$140', '~$250'], ['ओवन इग्नाइटर / एलिमेंट', '$130', '~$240']],
    priceCredit: '<b>आपका निदान शुल्क कभी बर्बाद नहीं होता।</b> Quick Check ($50) या घर पर निदान ($100) का हर डॉलर आगे बढ़ने पर सीधे आपकी मरम्मत मज़दूरी में जुड़ जाता है। आप एक ही बार भुगतान करते हैं — कभी भी निदान <em>और</em> मरम्मत दोनों के लिए नहीं।',
    revLabel: 'ग्राहक क्या कहते हैं', revH2: 'असली पड़ोसियों द्वारा 4.5★ रेटेड',
    revCount: 'सत्यापित Google समीक्षाएँ · मध्य TN और लुइज़ियाना', revAll: 'हमारी सभी Google समीक्षाएँ पढ़ें →',
    areaLabel: 'हम कहाँ सेवा देते हैं', areaH2: 'मध्य टेनेसी + लुइज़ियाना',
    brandLabel: 'हम जिन ब्रांडों की मरम्मत करते हैं', brandH2: 'हर बड़ा ब्रांड',
    faqLabel: 'सामान्य प्रश्न', faqH2: 'लोग यह भी पूछते हैं',
    faq: [
      ['मुझे कितनी जल्दी निदान मिल सकता है?', 'Ant को कभी भी बताएँ क्या दिक्कत है — एक असली तकनीशियन आपका वीडियो और मॉडल नंबर देखता है, आमतौर पर कुछ घंटों में, और आपकी 4-विकल्प Technician Decision Report बनाता है।'],
      ['क्या मैं निदान और मरम्मत दोनों के लिए भुगतान करता हूँ?', 'नहीं। आगे बढ़ने पर आपका $50 Quick Check या $100 घर-पर निदान सीधे मरम्मत मज़दूरी में जुड़ जाता है। आप एक ही बार भुगतान करते हैं।'],
      ['क्या आप पुराने उपकरण बेचते हैं?', 'नहीं — हम मरम्मत की दुकान हैं, पुराने उपकरण की दुकान नहीं। हम आपके पास जो है उसे ठीक करते हैं और ठीक करें-या-बदलें का ईमानदार जवाब देते हैं।'],
      ['आप कौन-से क्षेत्र कवर करते हैं?', 'मध्य टेनेसी (नैशविल, मर्फ़्रीसबरो, एंटीयोक, क्लार्क्सविल और आसपास) और लुइज़ियाना (न्यू ऑरलियन्स, बैटन रूज, हैमंड और दोनों किनारे)।'],
    ],
    ctaLabel: 'शुरू करें', ctaH2: 'Ant को बताएँ क्या दिक्कत है — आज ही असली जवाब पाएँ',
    ctaP: 'एक छोटा वीडियो और अपना मॉडल नंबर भेजें, और एक असली तकनीशियन आपकी Technician Decision Report बनाएगा। कोई होल्ड म्यूज़िक नहीं, कोई अंदाज़ा नहीं, विकल्प देखने तक कोई प्रतिबद्धता नहीं।',
    ctaPrimary: '🐜 Ant के साथ शुरू करें', ctaSecondary: '📞 कॉल करें 615-280-2949',
    footLinks: ['यह कैसे काम करता है', 'ठीक करें या बदलें?', 'Appliance Ant', 'ड्रायर मरम्मत', 'रेफ्रिजरेटर मरम्मत', 'गोपनीयता', 'SMS शर्तें'],
    footFine: 'TN Appliance Exchange · 615-280-2949 (TN) · 504-355-9111 (LA) · पारिवारिक, तकनीशियन-आधारित, 2012 से',
    jsPh: { Washer: 'जैसे पानी नहीं निकलता या स्पिन नहीं होता…', Dryer: 'जैसे गरम नहीं होता…', Refrigerator: 'जैसे ठंडा नहीं होता…', Dishwasher: 'जैसे पानी नहीं निकलता…', Oven: 'जैसे गरम नहीं होता…' },
  },

  ar: {
    name: 'العربية', dir: 'rtl',
    title: 'إصلاح الأجهزة المنزلية في ناشفيل ولويزيانا — في نفس اليوم، 4.5★ · أكثر من 1000 تقييم | TN Appliance Exchange',
    desc: 'جهازك معطّل؟ أخبر Ant بالمشكلة — فنّي محلي حقيقي يعطيك إجابة صادقة و4 خيارات واضحة، في نفس اليوم. عمل عائلي منذ 2012. وسط تينيسي + لويزيانا. نردّ عليك فورًا.',
    ogTitle: 'TN Appliance Exchange — إصلاح صادق يقوده الفنيون',
    navTag: 'توقّف عن التخمين. اسأل فنيًّا.', pill: 'Ant متصل الآن',
    trustReviews: 'تقييمات Google', trustFamily: 'عمل عائلي منذ', trustSameday: 'في نفس اليوم',
    h1: 'ما المشكلة في جهازك؟',
    heroSub: 'أخبر Ant — فنّي محلي حقيقي يعطيك <strong>إجابة صادقة، في نفس اليوم.</strong> بلا مركز اتصال، بلا تخمين.',
    askPh: 'اكتبها هنا — مثل «مجفّفي لا يسخّن»', startBtn: 'ابدأ →',
    chips: ['🌀 غسّالة', '🔥 مجفّفة', '🧊 ثلّاجة', '🍽️ غسّالة صحون', '🍳 موقد / فرن'],
    ccFine: 'يراجعها فنّي حقيقي، عادةً خلال ساعات. بالبدء فإنك توافق على تلقّي رسائل نصية حول إصلاحك.',
    ccSms: 'شروط الرسائل', ccPriv: 'الخصوصية', ccCall: 'أو اتصل على',
    badges: ['مرخّص ومؤمّن', 'فنّيون مدقّقو الخلفية', 'عائلي، يقوده الفنيون', 'رسوم التشخيص تُخصم من إصلاحك', 'وسط تينيسي + لويزيانا'],
    hiwLabel: 'كيف يعمل', hiwH2: 'ثلاث خطوات لإجابة حقيقية',
    steps: [
      ['أخبر Ant بالمشكلة', 'اكتبها أو اختر جهازك بالأعلى. أرسل مقطعًا قصيرًا وصورة لملصق رقم الموديل — هذا كل ما يحتاجه الفنّي.'],
      ['فنّي حقيقي يراجعها', 'ليس روبوتًا ولا مركز اتصال — فنّي حقيقي ينظر إلى جهازك، عادةً خلال ساعات، ويعرف بالضبط ما الذي يحدث.'],
      ['تحصل على أربعة خيارات صادقة', 'يعرض تقرير قرار الفنّي السعر الحقيقي بأربع طرق. اختر ما يناسبك — ركّب القطعة بنفسك أو نركّبها لك. رسوم التشخيص تُخصم من الإصلاح.'],
    ],
    tdrLabel: 'تقرير قرار الفنّي', tdrH2: 'أربعة خيارات، سعر حقيقي، القرار لك',
    tdrProse: 'يبدأ كل إصلاح بفنّي حقيقي يراجع موديلك والأعراض. ترى الصورة كاملة دائمًا وتختار — بلا ضغط، وبلا رقم «شامل» غامض يخفي الربح بداخله.',
    tdrCards: [
      ['قطعة OEM فقط', 'نوفّر قطعة OEM الأصلية المطابقة ونشحنها إليك. تركّبها بنفسك. الأفضل لمن يصلح بنفسه ويريد تركيبًا مضمونًا.'],
      ['قطعة اقتصادية فقط', 'قطعة متوافقة مفحوصة بسعر أقل، تصل إلى بابك. تركّبها بنفسك. رائعة عندما يكون التركيب بسيطًا.'],
      ['قطعة OEM + نركّبها', 'نوفّر قطعة OEM ويركّبها فنّينا. الأفضل عندما يكون التركيب دقيقًا أو الوصول صعبًا.'],
      ['قطعة اقتصادية + نركّبها', 'نوفّر قطعة مكافئة ونركّبها — التوازن بين التكلفة والراحة.'],
    ],
    crewLabel: 'تعرّف على الفريق', crewH2: 'أشخاص حقيقيون يصلحون جهازك',
    crewProse: 'بلا مركز اتصال. بلا نصّ امتياز تجاري. TN Appliance Exchange ورشة عائلية تُصلح الأجهزة في وسط تينيسي وجنوب لويزيانا منذ 2012.',
    crew: ['المالك والمؤسّس، يعمل بيديه منذ 2012.', 'جنوب ناشفيل وكل وسط تينيسي.', 'كلاركسفيل ووسط تينيسي، مع الورشة منذ 2020.', 'الجيل الثالث — ابن Teddy، ضفّتا لويزيانا.', 'أكثر من 40 عامًا مع الأجهزة، في كل لويزيانا.'],
    videoCap: 'Teddy في ورشة TN Appliance — عمل إصلاح حقيقي، إجابات صادقة، بلا تخمين.',
    fixLabel: 'ما الذي نُصلحه', fixH2: 'فريق واحد، كل الأجهزة',
    fix: ['غسّالات', 'مجفّفات', 'ثلّاجات', 'غسّالات صحون', 'مواقد وأفران', 'تنظيف مجرى المجفّفة'],
    priceLabel: 'سعر ثابت وصادق', priceH2: 'أرقام حقيقية بلا غموض',
    priceProse: 'نحدّد <strong>سعر عمالة ثابتًا لكل مهمّة</strong> — ثم القطعة المطابقة بسعر تكلفتنا الحقيقي مع هامش عادل. هذه عمالتنا الثابتة بجانب ما تتقاضاه الورشة المتوسّطة «شاملًا» (قطع <em>وعمالة</em>) للمهام الشائعة.',
    priceHead: ['إصلاح شائع', 'عمالتنا الثابتة', 'ورشة متوسّطة، شامل'],
    priceRows: [['عنصر تسخين المجفّفة', '$120', '~$230'], ['مضخّة تصريف الغسّالة', '$130', '~$210'], ['لوحة تحكّم / ثرموستات الثلّاجة', '$170', '~$290'], ['مضخّة / صمّام غسّالة الصحون', '$140', '~$250'], ['قدّاحة / عنصر الفرن', '$130', '~$240']],
    priceCredit: '<b>رسوم التشخيص لا تضيع أبدًا.</b> كل دولار من الفحص السريع (50$) أو التشخيص المنزلي (100$) يُخصم مباشرةً من عمالة إصلاحك إذا تابعت. تدفع مرّة واحدة فقط — لا للتشخيص <em>و</em> الإصلاح معًا أبدًا.',
    revLabel: 'ماذا يقول العملاء', revH2: 'تقييم 4.5★ من جيران حقيقيين',
    revCount: 'تقييمات Google موثّقة · وسط تينيسي ولويزيانا', revAll: 'اقرأ كل تقييمات Google لدينا →',
    areaLabel: 'أين نخدم', areaH2: 'وسط تينيسي + لويزيانا',
    brandLabel: 'العلامات التي نُصلحها', brandH2: 'كل علامة كبرى',
    faqLabel: 'أسئلة شائعة', faqH2: 'يسأل الناس أيضًا',
    faq: [
      ['بأيّ سرعة أحصل على تشخيص؟', 'أخبر Ant بالمشكلة في أي وقت — فنّي حقيقي يراجع مقطعك ورقم موديلك، عادةً خلال ساعات، ويُعدّ لك تقرير قرار الفنّي بأربعة خيارات.'],
      ['هل أدفع للتشخيص وللإصلاح معًا؟', 'لا. الفحص السريع بـ50$ أو التشخيص المنزلي بـ100$ يُخصم مباشرةً من العمالة إذا تابعت. تدفع مرّة واحدة فقط.'],
      ['هل تبيعون أجهزة مستعملة؟', 'لا — نحن ورشة إصلاح، لسنا متجر أجهزة مستعملة. نُصلح ما لديك ونعطيك إجابة صادقة: إصلاح أم استبدال.'],
      ['ما المناطق التي تغطّونها؟', 'وسط تينيسي (ناشفيل، مرفريسبورو، أنتيوك، كلاركسفيل وما حولها) ولويزيانا (نيو أورليانز، باتون روج، هاموند وكلتا الضفّتين).'],
    ],
    ctaLabel: 'ابدأ الآن', ctaH2: 'أخبر Ant بالمشكلة — واحصل على إجابة حقيقية اليوم',
    ctaP: 'أرسل مقطعًا قصيرًا ورقم موديلك، وسيُعدّ فنّي حقيقي تقرير قرار الفنّي الخاص بك. بلا موسيقى انتظار، بلا تخمين، وبلا التزام حتى ترى خياراتك.',
    ctaPrimary: '🐜 ابدأ مع Ant', ctaSecondary: '📞 اتصل 615-280-2949',
    footLinks: ['كيف يعمل', 'إصلاح أم استبدال؟', 'Appliance Ant', 'إصلاح المجفّفات', 'إصلاح الثلّاجات', 'الخصوصية', 'شروط الرسائل'],
    footFine: 'TN Appliance Exchange · 615-280-2949 (TN) · 504-355-9111 (LA) · عائلي، يقوده الفنيون منذ 2012',
    jsPh: { Washer: 'مثال: لا تصرّف الماء أو لا تعصر…', Dryer: 'مثال: لا يسخّن…', Refrigerator: 'مثال: لا يبرّد…', Dishwasher: 'مثال: لا تصرّف الماء…', Oven: 'مثال: لا يسخّن…' },
  },
};

const LANGS = ['es', 'vi', 'ar', 'hi', 'fr'];
const NAMES = { en: 'English', es: 'Español', vi: 'Tiếng Việt', ar: 'العربية', hi: 'हिन्दी', fr: 'Français' };
const APPL = ['Washer', 'Dryer', 'Refrigerator', 'Dishwasher', 'Oven', 'DryerVent'];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Read the English index.html once so we inherit its EXACT <style> block (single
// source of truth for the look). We only swap the head-meta + the body text.
const STYLE = (function () {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<style>[\s\S]*?<\/style>/);
  return m ? m[0] : '';
})();

function langbar(cur) {
  const parts = ['en', ...LANGS].map((code) => {
    const href = code === 'en' ? 'https://tnapplianceexchange.net/' : `/${code}/`;
    const on = code === cur ? ' style="color:var(--orange)"' : '';
    return `<a href="${href}"${on} style="color:var(--gray);text-decoration:none;font-size:12px">${NAMES[code]}</a>`;
  });
  return parts.join('<span style="color:var(--gray2)">·</span>');
}

function page(code) {
  const t = T[code];
  const L = code; const rtl = t.dir === 'rtl';
  const ai = (a) => `/appliance-ai.html?lang=${L}${a ? '&appliance=' + a : ''}`;
  const fixIcons = ['🌀', '🔥', '🧊', '🍽️', '🍳', '🌬️'];
  const hreflang = ['en', ...LANGS].map((c) => `<link rel="alternate" hreflang="${c}" href="${c === 'en' ? 'https://tnapplianceexchange.net/' : 'https://tnapplianceexchange.net/' + c + '/'}">`).join('\n') + '\n<link rel="alternate" hreflang="x-default" href="https://tnapplianceexchange.net/">';

  return `<!DOCTYPE html>
<html lang="${L}"${rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0EF3THNXLE"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-0EF3THNXLE');</script>
<script src="/meta-pixel.js"></script>
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#050505">
<link rel="canonical" href="https://tnapplianceexchange.net/${L}/">
${hreflang}
<meta property="og:type" content="website">
<meta property="og:url" content="https://tnapplianceexchange.net/${L}/">
<meta property="og:title" content="${esc(t.ogTitle)}">
<meta property="og:description" content="${esc(t.desc)}">
<meta property="og:site_name" content="TN Appliance Exchange">
<meta property="og:image" content="https://tnapplianceexchange.net/og-default.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","@id":"https://tnapplianceexchange.net/#business","name":"TN Appliance Exchange","url":"https://tnapplianceexchange.net/${L}/","telephone":"+1-866-268-0111","image":"https://tnapplianceexchange.net/og-default.png","priceRange":"$50-$600","areaServed":[{"@type":"State","name":"Tennessee"},{"@type":"State","name":"Louisiana"}],"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":"1081","bestRating":"5"}}</script>
${STYLE}
<style>.langbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap}@media(max-width:600px){.langbar{display:none}}</style>
</head>
<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">

<nav>
  <a href="/${L}/" class="nav-brand"><span class="nav-ant">🐜</span><div><div class="nav-name">TN Appliance Exchange</div><div class="nav-tag">${esc(t.navTag)}</div></div></a>
  <div class="nav-right"><nav class="langbar">${langbar(L)}</nav><div class="pill"><span class="pill-dot"></span>${esc(t.pill)}</div><a href="tel:6152802949" class="nav-call">615-280-2949</a></div>
</nav>

<div class="hero">
  <div class="trust-line"><span class="star">★</span> <b>4.5</b> · 1,000+ ${esc(t.trustReviews)} · <b>${esc(t.trustFamily)} 2012</b> · <b>${esc(t.trustSameday)}</b></div>
  <span class="hero-ant">🐜</span>
  <h1>${esc(t.h1)}</h1>
  <p class="hero-sub">${t.heroSub}</p>

  <form class="ask" id="askForm" onsubmit="return false">
    <input id="ccText" type="text" placeholder="${esc(t.askPh)}" autocomplete="off">
    <button class="cc-go" id="ccGo" type="submit">${esc(t.startBtn)}</button>
  </form>
  <div class="chips" id="chips">
    ${t.chips.map((c, i) => `<button class="chip" data-a="${APPL[i]}">${esc(c)}</button>`).join('\n    ')}
  </div>
  <div class="cc-fine">${esc(t.ccFine)} <a href="/terms">${esc(t.ccSms)}</a> · <a href="/privacy">${esc(t.ccPriv)}</a>. ${esc(t.ccCall)} <a href="tel:6152802949">615-280-2949</a>.</div>
</div>

<div class="trust-strip">
  <div class="trust-badges">
    ${t.badges.map((b) => `<span class="badge"><span class="bi">✓</span> <b>${esc(b)}</b></span>`).join('\n    ')}
  </div>
</div>

<div class="content">

  <div class="section">
    <div class="section-label">${esc(t.hiwLabel)}</div>
    <h2>${esc(t.hiwH2)}</h2>
    <div class="steps">
      ${t.steps.map((s, i) => `<div class="step"><div class="step-n">${i + 1}</div><div><h3>${esc(s[0])}</h3><p>${esc(s[1])}</p></div></div>`).join('\n      ')}
    </div>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.tdrLabel)}</div>
    <h2>${esc(t.tdrH2)}</h2>
    <p class="prose">${esc(t.tdrProse)}</p>
    <div class="tdr-grid">
      ${t.tdrCards.map((c, i) => `<div class="tdr-card"><div class="tdr-num">${i + 1}</div><div class="tdr-name">${esc(c[0])}</div><div class="tdr-desc">${esc(c[1])}</div></div>`).join('\n      ')}
    </div>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.crewLabel)}</div>
    <h2>${esc(t.crewH2)}</h2>
    <p class="prose">${esc(t.crewProse)}</p>
    <div class="crew">
      <div class="crew-card"><img src="/team/teddy-owner.jpg" alt="Teddy" loading="lazy"><div><div class="cn">Teddy</div><p>${esc(t.crew[0])}</p></div></div>
      <div class="crew-card"><img src="/team/jimmy-nashville.jpg" alt="Jimmy" loading="lazy"><div><div class="cn">Jimmy</div><p>${esc(t.crew[1])}</p></div></div>
      <div class="crew-card"><img src="/team/lee-clarksville.jpg" alt="Lee" loading="lazy"><div><div class="cn">Lee</div><p>${esc(t.crew[2])}</p></div></div>
      <div class="crew-card"><img src="/team/andre-south-shore.jpg" alt="Andre" loading="lazy"><div><div class="cn">Andre</div><p>${esc(t.crew[3])}</p></div></div>
      <div class="crew-card"><img src="/team/john-north-shore.jpg" alt="John" loading="lazy"><div><div class="cn">John</div><p>${esc(t.crew[4])}</p></div></div>
    </div>
    <video id="shopVideo" controls playsinline preload="none" poster="https://tnapplianceexchange.net/.netlify/functions/media-file?key=social/clips/poster-755199354557734.jpg" src="https://tnapplianceexchange.net/.netlify/functions/media-file?key=social%2Fclips%2Ffbarch-755199354557734.mp4" style="width:100%;max-width:400px;border-radius:14px;background:#000;display:block;margin:22px auto 0"></video>
    <p class="prose" style="text-align:center;max-width:none;font-size:12.5px;opacity:.82;margin-top:10px">${esc(t.videoCap)}</p>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.fixLabel)}</div>
    <h2>${esc(t.fixH2)}</h2>
    <div class="a-grid">
      ${t.fix.map((f, i) => `<a href="${ai(APPL[i])}" class="a-link"><span class="ai">${fixIcons[i]}</span> ${esc(f)}</a>`).join('\n      ')}
    </div>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.priceLabel)}</div>
    <h2>${esc(t.priceH2)}</h2>
    <p class="prose">${t.priceProse}</p>
    <div class="ptable">
      <div class="prow"><span class="pl">${esc(t.priceHead[0])}</span><span class="p1">${esc(t.priceHead[1])}</span><span class="p2">${esc(t.priceHead[2])}</span></div>
      ${t.priceRows.map((r) => `<div class="prow"><span class="pl">${esc(r[0])}</span><span class="p1">${r[1]}</span><span class="p2">${r[2]}</span></div>`).join('\n      ')}
    </div>
    <div class="credit-note">${t.priceCredit}</div>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.revLabel)}</div>
    <h2>${esc(t.revH2)}</h2>
    <div class="rev-head">
      <span class="rev-score" id="revScore">4.5</span>
      <div><div class="rev-stars">★★★★★</div><div class="rev-count"><span id="revCount">1,081</span> ${esc(t.revCount)}</div></div>
    </div>
    <div class="rev-grid" id="revGrid"></div>
    <p class="prose" style="margin-top:16px"><a href="https://g.page/r/CRt-vo--eAJ3EBM/review" target="_blank" rel="noopener">${esc(t.revAll)}</a></p>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.areaLabel)}</div>
    <h2>${esc(t.areaH2)}</h2>
    <div class="tags">
      <a href="/nashville" class="tag">Nashville</a><a href="/murfreesboro" class="tag">Murfreesboro</a><a href="/antioch" class="tag">Antioch</a><a href="/clarksville" class="tag">Clarksville</a><a href="/franklin" class="tag">Franklin</a><a href="/hermitage" class="tag">Hermitage</a><a href="/new-orleans" class="tag">New Orleans</a><a href="/baton-rouge" class="tag">Baton Rouge</a><a href="/hammond" class="tag">Hammond</a><a href="/metairie" class="tag">Metairie</a><a href="/slidell" class="tag">Slidell</a><a href="/mandeville" class="tag">Mandeville</a>
    </div>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.brandLabel)}</div>
    <h2>${esc(t.brandH2)}</h2>
    <div class="brand-grid">
      <a href="/whirlpool-appliance-repair" class="brand-link">Whirlpool</a><a href="/samsung-appliance-repair" class="brand-link">Samsung</a><a href="/lg-appliance-repair" class="brand-link">LG</a><a href="/ge-appliance-repair" class="brand-link">GE</a><a href="/frigidaire-appliance-repair" class="brand-link">Frigidaire</a><a href="/maytag-appliance-repair" class="brand-link">Maytag</a><a href="/bosch-appliance-repair" class="brand-link">Bosch</a><a href="/kenmore-appliance-repair" class="brand-link">Kenmore</a>
    </div>
  </div>

  <div class="section">
    <div class="section-label">${esc(t.faqLabel)}</div>
    <h2>${esc(t.faqH2)}</h2>
    <div class="faq">
      ${t.faq.map((f) => `<div class="faq-item"><div class="faq-q">${esc(f[0])}</div><div class="faq-a">${esc(f[1])}</div></div>`).join('\n      ')}
    </div>
  </div>

</div>

<div class="cta-section">
  <div class="cta-inner">
    <div class="section-label">${esc(t.ctaLabel)}</div>
    <h2>${esc(t.ctaH2)}</h2>
    <p>${esc(t.ctaP)}</p>
    <div class="cta-row">
      <a href="${ai('')}" class="btn-primary">${esc(t.ctaPrimary)}</a>
      <a href="tel:6152802949" class="btn-secondary">${esc(t.ctaSecondary)}</a>
    </div>
  </div>
</div>

<footer>
  <div class="fl"><a href="/nashville">Nashville</a><span>·</span><a href="/murfreesboro">Murfreesboro</a><span>·</span><a href="/antioch">Antioch</a><span>·</span><a href="/new-orleans">New Orleans</a><span>·</span><a href="/baton-rouge">Baton Rouge</a><span>·</span><a href="/hammond">Hammond</a></div>
  <div class="fl">${t.footLinks.map((l, i) => `<a href="${['/how-it-works', '/should-i-repair-or-replace', '/appliance-ant', '/dryer-repair', '/refrigerator-repair', '/privacy', '/terms'][i]}">${esc(l)}</a>`).join('<span>·</span>')}</div>
  <div class="ft">${esc(t.footFine)}</div>
</footer>

</div>

<script>
(function(){
  var picked='';
  var chips=document.getElementById('chips');
  var text=document.getElementById('ccText');
  var placeholders=${JSON.stringify(t.jsPh)};
  chips.addEventListener('click',function(e){
    var b=e.target.closest('.chip'); if(!b) return;
    [].forEach.call(chips.children,function(c){c.classList.remove('on');});
    b.classList.add('on'); picked=b.getAttribute('data-a');
    if(placeholders[picked]) text.placeholder=placeholders[picked];
    text.focus();
  });
  function go(){
    var q=['lang=${L}']; if(picked) q.push('appliance='+encodeURIComponent(picked));
    var note=(text.value||'').trim(); if(note) q.push('note='+encodeURIComponent(note.slice(0,140)));
    window.location.href='/appliance-ai.html?'+q.join('&');
  }
  document.getElementById('ccGo').addEventListener('click',go);
  text.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
  try{ if(window.gtag) document.getElementById('ccGo').addEventListener('click',function(){gtag('event','intake_click',{source:'homepage_hero_${L}'});}); }catch(e){}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  fetch('/.netlify/functions/get-google-reviews').then(function(r){return r.json();}).then(function(d){
    if(!d||!d.ok) return;
    if(d.rating) document.getElementById('revScore').textContent=Number(d.rating).toFixed(1);
    if(d.review_count) document.getElementById('revCount').textContent=Number(d.review_count).toLocaleString();
    var good=(d.reviews||[]).filter(function(rv){return (rv.rating>=4)&&rv.text&&rv.text.length>=40;}).slice(0,4);
    if(!good.length) return;
    document.getElementById('revGrid').innerHTML=good.map(function(rv){
      var tx=rv.text.length>240?rv.text.slice(0,238)+'…':rv.text;
      return '<div class="rev-card"><div class="rs">★★★★★</div><p>'+esc(tx)+'</p><div class="rn">— '+esc(rv.author||'Google')+'</div></div>';
    }).join('');
  }).catch(function(){});
  // shop video streams from the same-origin proxy (src in HTML, preload=none).
})();
</script>
<script src="/ant-track.js" defer></script>
</body>
</html>
`;
}

let n = 0;
for (const code of LANGS) {
  const dir = path.join(ROOT, code);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(code), 'utf8');
  n++;
  console.log('wrote', code + '/index.html');
}
console.log('done —', n, 'homepages regenerated');
