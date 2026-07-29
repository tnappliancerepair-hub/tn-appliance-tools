// review-i18n — in-language "How'd we do?" + Google-review messages.
// The star is the review-link nudge: it asks happy customers to write the review
// IN THEIR LANGUAGE, so other in-language families find us (the trust flywheel).
// Languages: en, es, ru, vi, fr, ar, zh, hi.  Falls back to en.

// Parse the "⚑ Customer language: Spanish" flag (written into customer_preference_text
// at intake) back to a code. Also accepts a raw code.
const NAME2CODE = { spanish: 'es', vietnamese: 'vi', russian: 'ru', french: 'fr', arabic: 'ar', chinese: 'zh', hindi: 'hi', english: 'en' };
function langFromPref(pref) {
  const m = /⚑\s*Customer language:\s*([A-Za-z]+)/.exec(String(pref || ''));
  if (m) return NAME2CODE[m[1].toLowerCase()] || 'en';
  return 'en';
}
function normLang(x) {
  const s = String(x || '').toLowerCase().trim();
  if (M[s]) return s;
  return NAME2CODE[s] || 'en';
}

// hint that naming tech + city helps neighbors — kept short per language
function hintOf(lang, tech, city) {
  const bits = [tech, city].filter(Boolean);
  if (!bits.length) return '';
  const j = bits.join(lang === 'ar' ? ' و' : (lang === 'zh' ? '、' : (lang === 'ru' ? ' и ' : (lang === 'fr' ? ' et ' : (lang === 'es' ? ' y ' : (lang === 'vi' ? ' và ' : (lang === 'hi' ? ' और ' : ' and ')))))));
  return { en: ` — a mention of ${j} helps neighbors find us`,
           es: ` — mencionar a ${j} ayuda a que tus vecinos te encuentren`,
           ru: ` — упоминание ${j} помогает соседям нас найти`,
           vi: ` — nhắc đến ${j} giúp hàng xóm tìm thấy chúng tôi`,
           fr: ` — mentionner ${j} aide vos voisins à nous trouver`,
           ar: ` — ذكر ${j} يساعد جيرانك على إيجادنا`,
           zh: `（提到 ${j} 能帮邻居找到我们）`,
           hi: ` — ${j} का ज़िक्र पड़ोसियों को हमें ढूंढने में मदद करता है` }[lang] || '';
}

const M = {
  en: {
    ask: (f, a) => `Hi ${f}, thanks for letting TN Appliance Exchange take care of your${a ? ' ' + a : ''} repair! Quick question — how'd we do? Reply 👍 if we did great, or 👎 if we missed the mark.`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `So glad ${tech} got your ${appl} sorted, ${f}! 🙏` : tech ? `So glad ${tech} took good care of you, ${f}! 🙏` : appl ? `So glad we got your ${appl} sorted, ${f}! 🙏` : `So glad to hear it, ${f}! 🙏`; return `${o} If you've got 30 seconds, a quick Google review would mean the world to our small team${hintOf('en', tech, city)}: ${url}`; },
    neg: (f) => `I'm sorry we didn't get it right, ${f}. What could we have done better? Your reply comes straight to me — I want to make it right. — Teddy, TN Appliance`,
    ack: (f) => `Thank you, ${f} — I've got this and I'll personally look into it. We want to make it right. — Teddy, TN Appliance`,
  },
  es: {
    ask: (f, a) => `Hola ${f}, ¡gracias por confiar en TN Appliance Exchange para tu reparación${a ? ' de ' + a : ''}! Una pregunta rápida — ¿cómo lo hicimos? Responde 👍 si quedaste contento, o 👎 si fallamos.`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `¡Qué bueno que ${tech} arregló tu ${appl}, ${f}! 🙏` : tech ? `¡Qué bueno que ${tech} te atendió bien, ${f}! 🙏` : `¡Qué bueno, ${f}! 🙏`; return `${o} Si tienes 30 segundos, una reseña en Google significaría muchísimo para nuestro pequeño equipo${hintOf('es', tech, city)}: ${url}\n\nPuedes escribirla en español — así otras familias hispanas nos encuentran más fácil. 🙌`; },
    neg: (f) => `Lamento que no lo hiciéramos bien, ${f}. ¿Qué pudimos haber hecho mejor? Tu respuesta me llega directo a mí — quiero arreglarlo. — Teddy, TN Appliance`,
    ack: (f) => `Gracias, ${f} — yo me encargo personalmente. Queremos hacerlo bien. — Teddy, TN Appliance`,
  },
  ru: {
    ask: (f, a) => `Здравствуйте, ${f}! Спасибо, что доверили ремонт TN Appliance Exchange. Короткий вопрос — как мы справились? Ответьте 👍 если всё отлично, или 👎 если что-то не так.`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `Очень рады, что ${tech} починил ваш ${appl}, ${f}! 🙏` : tech ? `Очень рады, что ${tech} вам помог, ${f}! 🙏` : `Очень рады, ${f}! 🙏`; return `${o} Если найдётся 30 секунд, отзыв в Google очень поможет нашей небольшой команде${hintOf('ru', tech, city)}: ${url}\n\nМожно написать по-русски — так другим русскоязычным семьям легче нас найти. 🙌`; },
    neg: (f) => `Извините, что не оправдали ожиданий, ${f}. Что мы могли сделать лучше? Ваш ответ придёт прямо мне — хочу всё исправить. — Тедди, TN Appliance`,
    ack: (f) => `Спасибо, ${f} — я лично этим займусь. Мы всё исправим. — Тедди, TN Appliance`,
  },
  vi: {
    ask: (f, a) => `Chào ${f}, cảm ơn quý vị đã tin tưởng TN Appliance Exchange sửa chữa! Một câu hỏi nhanh — chúng tôi làm thế nào? Trả lời 👍 nếu hài lòng, hoặc 👎 nếu chưa tốt.`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `Thật vui vì ${tech} đã sửa xong ${appl} cho quý vị, ${f}! 🙏` : tech ? `Thật vui vì ${tech} đã chăm sóc quý vị chu đáo, ${f}! 🙏` : `Thật vui, ${f}! 🙏`; return `${o} Nếu có 30 giây, một đánh giá trên Google sẽ giúp ích rất nhiều cho đội ngũ nhỏ của chúng tôi${hintOf('vi', tech, city)}: ${url}\n\nQuý vị có thể viết bằng tiếng Việt — để các gia đình người Việt khác dễ tìm thấy chúng tôi hơn. 🙌`; },
    neg: (f) => `Xin lỗi vì chưa làm tốt, ${f}. Chúng tôi có thể làm gì tốt hơn? Tin nhắn của quý vị đến thẳng tôi — tôi muốn sửa cho đúng. — Teddy, TN Appliance`,
    ack: (f) => `Cảm ơn ${f} — tôi sẽ đích thân lo việc này. Chúng tôi muốn làm cho đúng. — Teddy, TN Appliance`,
  },
  fr: {
    ask: (f, a) => `Bonjour ${f}, merci d'avoir confié votre réparation à TN Appliance Exchange ! Une petite question — comment avons-nous fait ? Répondez 👍 si vous êtes satisfait, ou 👎 si nous avons manqué le coche.`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `Ravi que ${tech} ait réparé votre ${appl}, ${f} ! 🙏` : tech ? `Ravi que ${tech} ait bien pris soin de vous, ${f} ! 🙏` : `Ravi de l'entendre, ${f} ! 🙏`; return `${o} Si vous avez 30 secondes, un avis Google compterait énormément pour notre petite équipe${hintOf('fr', tech, city)} : ${url}\n\nVous pouvez l'écrire en français — ça aide d'autres familles francophones à nous trouver. 🙌`; },
    neg: (f) => `Désolé de ne pas avoir été à la hauteur, ${f}. Qu'aurions-nous pu faire de mieux ? Votre réponse m'arrive directement — je veux corriger ça. — Teddy, TN Appliance`,
    ack: (f) => `Merci, ${f} — je m'en occupe personnellement. On veut bien faire les choses. — Teddy, TN Appliance`,
  },
  ar: {
    ask: (f, a) => `مرحبًا ${f}، شكرًا لثقتك بـ TN Appliance Exchange في إصلاح جهازك! سؤال سريع — كيف كان أداؤنا؟ رد بـ 👍 إذا كنت راضيًا، أو 👎 إذا قصّرنا.`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `يسعدنا أن ${tech} أصلح ${appl} الخاص بك، ${f}! 🙏` : tech ? `يسعدنا أن ${tech} اعتنى بك جيدًا، ${f}! 🙏` : `يسعدنا ذلك، ${f}! 🙏`; return `${o} إذا كان لديك 30 ثانية، تقييم على Google سيعني الكثير لفريقنا الصغير${hintOf('ar', tech, city)}: ${url}\n\nيمكنك كتابته بالعربية — حتى تجدنا عائلات عربية أخرى بسهولة. 🙌`; },
    neg: (f) => `آسف لأننا لم نوفّق، ${f}. ماذا كان بإمكاننا أن نفعل بشكل أفضل؟ ردّك يصلني مباشرة — أريد أن أصلح الأمر. — تيدي، TN Appliance`,
    ack: (f) => `شكرًا، ${f} — سأتولى الأمر بنفسي. نريد أن نصلحه. — تيدي، TN Appliance`,
  },
  zh: {
    ask: (f, a) => `您好 ${f}，感谢您选择 TN Appliance Exchange 维修！想请教一下——我们做得怎么样？满意请回复 👍，不满意请回复 👎。`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `很高兴 ${tech} 修好了您的${appl}，${f}！🙏` : tech ? `很高兴 ${tech} 为您服务周到，${f}！🙏` : `太好了，${f}！🙏`; return `${o} 如果您有 30 秒，在 Google 上留个评价对我们的小团队意义重大${hintOf('zh', tech, city)}：${url}\n\n您可以用中文写——这样其他华人家庭更容易找到我们。🙌`; },
    neg: (f) => `很抱歉这次没做好，${f}。我们哪里可以做得更好？您的回复会直接发给我——我想把它做对。—— Teddy，TN Appliance`,
    ack: (f) => `谢谢您，${f}——我会亲自处理。我们想把它做好。—— Teddy，TN Appliance`,
  },
  hi: {
    ask: (f, a) => `नमस्ते ${f}, TN Appliance Exchange पर भरोसा करने के लिए धन्यवाद! एक छोटा सवाल — हमने कैसा काम किया? खुश हैं तो 👍 भेजें, या कुछ कमी रही तो 👎।`,
    pos: (f, tech, appl, city, url) => { const o = tech && appl ? `बहुत खुशी हुई कि ${tech} ने आपका ${appl} ठीक कर दिया, ${f}! 🙏` : tech ? `बहुत खुशी हुई कि ${tech} ने आपका अच्छे से ध्यान रखा, ${f}! 🙏` : `बहुत खुशी हुई, ${f}! 🙏`; return `${o} अगर 30 सेकंड हों, तो Google पर एक समीक्षा हमारी छोटी टीम के लिए बहुत मायने रखेगी${hintOf('hi', tech, city)}: ${url}\n\nआप इसे हिंदी में लिख सकते हैं — इससे दूसरे भारतीय परिवारों को हमें ढूंढना आसान होता है। 🙌`; },
    neg: (f) => `माफ़ करें कि हम सही नहीं कर पाए, ${f}। हम क्या बेहतर कर सकते थे? आपका जवाब सीधे मुझे आता है — मैं इसे ठीक करना चाहता हूँ। — Teddy, TN Appliance`,
    ack: (f) => `धन्यवाद, ${f} — मैं ख़ुद इसे देखूंगा। हम इसे सही करना चाहते हैं। — Teddy, TN Appliance`,
  },
};

function pack(lang) { return M[normLang(lang)] || M.en; }

module.exports = { pack, langFromPref, normLang };
