// Office Assistant brain — "Ant" for Danielle. She talks in plain language and
// Ant turns it into ONE structured action her board can execute (move a job to
// a folder, assign a tech, log labor, look something up). The board executes
// the action against the real endpoints (office_set_job_status, reassign_job,
// record_job_invoice) and refreshes — so talking to Ant literally moves cards.
//
// POST { message }
// -> { reply, intent, job_ref, target, amount }
//    intent: move | assign | labor | search | none
//
// Uses Claude when ANTHROPIC_API_KEY is set; falls back to a deterministic
// parser so the core commands work even with no key.

const ANTHROPIC_URL='https://api.anthropic.com/v1/messages';
const MODEL='claude-haiku-4-5-20251001';

const TECHS=['teddy','jimmy','andre','lee','billy','john'];
const FOLDER_WORDS=[
  ['waiting_parts',/(waiting (for )?parts|awaiting parts|on parts|parts hold)/],
  ['completed',/(complete|completed|finished|done|mark done)/],
  ['needs_scheduled',/(needs? schedul|reschedul|call ?back|second trip|2nd trip|re-?open|back to schedul)/],
  ['needs_invoice',/(needs? invoice|to invoice|invoice folder)/],
  ['follow_up',/(follow ?up)/],
];

// Pull labeled dollar amounts out of free speech, e.g.
// "part cost is 48, tax 2.14, labor 140, tech pay 60".
function extractFields(m){
  const f={};
  const grab=(re)=>{const x=m.match(re);return x?x[1]:null;};
  const labor=grab(/labou?r[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const part=grab(/parts?\s*(?:cost|charge|price)?[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const tax=grab(/tax[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const techpay=grab(/tech\s*pay[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const markup=grab(/mark\s*up[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const ship=grab(/ship(?:ping)?[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const tip=grab(/tip[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const amt=grab(/(?:invoice|total|amount)[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/);
  if(labor)f.labor=labor; if(part)f.part_cost=part; if(tax)f.tax=tax; if(techpay)f.tech_pay=techpay;
  if(markup)f.markup=markup; if(ship)f.shipping=ship; if(tip)f.tip=tip; if(amt)f.amount_invoiced=amt;
  return f;
}

function parseDeterministic(msg){
  const m=(msg||'').toLowerCase();
  let job_ref='';
  const numMatch=(msg||'').match(/#?\s*(\d{3,})/);
  if(numMatch) job_ref=numMatch[1];
  else { const nameMatch=(msg||'').match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/); if(nameMatch) job_ref=nameMatch[1]; }

  // delete junk / canceled-email job (Danielle's clear-the-list need)
  if(/(delete|trash|junk|bogus|duplicate|this is ?n'?t a (real )?job|not a (real )?job|canceled? email|cancelled? email|remove (it|this|that))/.test(m)){
    return {reply:'Deleting'+(job_ref?(' '+job_ref):' it')+' off the list (junk / canceled). Nobody gets texted.',intent:'delete',job_ref,target:'',amount:'',fields:{}};
  }
  // parts came in
  if(/parts?\s*(just\s*)?(came in|are in|is in|arrived|showed up|here|in now)/.test(m)){
    return {reply:'Marking parts in'+(job_ref?(' for '+job_ref):'')+' and moving it to Needs Scheduled.',intent:'parts_arrived',job_ref,target:'',amount:'',fields:{}};
  }
  // auto-schedule / put on the schedule
  if(/(auto.?schedule|put (it|them|this|that|him|her).*on the schedule|get (it|them|this|that).*(on the )?schedul|^schedule |\bschedule (it|them|this|that))/.test(m)){
    return {reply:'Putting'+(job_ref?(' '+job_ref):' it')+' on the schedule.',intent:'schedule',job_ref,target:'',amount:'',fields:{}};
  }
  // invoice breakdown (one or many labeled amounts)
  const fields=extractFields(m);
  if(Object.keys(fields).length>=1 && /(labou?r|parts?|tax|tech\s*pay|mark\s*up|ship|tip|invoice|charge|cost)/.test(m)){
    return {reply:'Logging the invoice'+(job_ref?(' for '+job_ref):'')+'.',intent:'invoice',job_ref,target:'',amount:'',fields};
  }
  // assign a tech
  const tech=TECHS.find(t=>m.includes(t));
  if(tech && /(assign|give|send|put .* on|to )/.test(m)){
    return {reply:'Assigning '+cap(tech)+(job_ref?(' to '+job_ref):'')+'.',intent:'assign',job_ref,target:cap(tech),amount:'',fields:{}};
  }
  // move to a folder/status
  for(const [folder,re] of FOLDER_WORDS){
    if(re.test(m)){
      return {reply:'Moving'+(job_ref?(' '+job_ref):'')+' to '+label(folder)+'.',intent:'move',job_ref,target:folder,amount:'',fields:{}};
    }
  }
  if(/(find|search|look ?up|where|show|pull up|open)/.test(m) && job_ref){
    return {reply:'Looking up '+job_ref+'.',intent:'search',job_ref,target:'',amount:'',fields:{}};
  }
  return {reply:"Tell me what to do — move a job to a folder, assign a tech, log the invoice (labor/parts/tax/tech pay), mark parts in, or auto-schedule it.",intent:'none',job_ref:'',target:'',amount:'',fields:{}};
}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function label(f){return {waiting_parts:'Waiting Parts',completed:'Completion',needs_scheduled:'Needs Scheduled',needs_invoice:'Needs Invoice',follow_up:'Follow Up'}[f]||f;}

async function parseWithClaude(msg){
  const key=process.env.ANTHROPIC_API_KEY;
  if(!key) return null;
  const sys='You are Ant, the office assistant for an appliance-repair company. The office manager talks in plain language (often by voice) to run her job board. '
    +'Parse her message into ONE action. Folders/statuses: needs_scheduled, waiting_parts, completed, follow_up, needs_invoice. Techs: Teddy, Jimmy, Andre, Lee, Billy, John. '
    +'Intents: move (change folder/status, incl. mark done/archive -> completed); assign (to a tech); invoice (log any of these dollar amounts: labor, part_cost, markup, shipping, tax, tip, tech_pay, amount_invoiced — she may say several at once); parts_arrived (parts came in / are here); schedule (put it on the schedule / auto-schedule it); delete (junk / canceled-email / not a real job / remove it off the list); search (look up/open a job); none (unclear). '
    +'job_ref = the job number OR customer name she names. target = folder/status (for move) or tech first name (for assign). '
    +'fields = object of any dollar amounts for invoice intent, e.g. {"labor":"140","part_cost":"48","tax":"2.14","tech_pay":"60"}. amount = a single dollar number if that is all she gives. '
    +'reply = one short friendly sentence confirming the action (or a clarifying question if intent=none). '
    +'Respond with STRICT JSON only: {"reply":"","intent":"","job_ref":"","target":"","amount":"","fields":{}}';
  try{
    const r=await fetch(ANTHROPIC_URL,{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:MODEL,max_tokens:400,system:sys,messages:[{role:'user',content:msg}]})});
    const d=await r.json();
    const text=(((d||{}).content||[])[0]||{}).text||'';
    const clean=text.replace(/```json/g,'').replace(/```/g,'').trim();
    const p=JSON.parse(clean);
    if(!p||!p.intent) return null;
    return p;
  }catch(_){return null;}
}

exports.config={timeout:26};
exports.handler=async function(event){
  if(event.httpMethod!=='POST') return {statusCode:405,body:'Method Not Allowed'};
  try{
    const {message}=JSON.parse(event.body||'{}');
    if(!message||!message.trim()) return {statusCode:400,body:JSON.stringify({reply:'Say what you need.',intent:'none'})};
    const ai=await parseWithClaude(message.trim());
    const out=ai||parseDeterministic(message.trim());
    return {statusCode:200,body:JSON.stringify(out)};
  }catch(err){
    return {statusCode:500,body:JSON.stringify({reply:'Something went wrong — '+err.message,intent:'none'})};
  }
};
