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

function parseDeterministic(msg){
  const m=(msg||'').toLowerCase();
  // job reference: a number (job/claim) or a Capitalized name in the original
  let job_ref='';
  const numMatch=(msg||'').match(/#?\s*(\d{3,})/);
  if(numMatch) job_ref=numMatch[1];
  else { const nameMatch=(msg||'').match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/); if(nameMatch) job_ref=nameMatch[1]; }

  // labor: "$140" or "140 labor" / "log labor 140"
  const amtMatch=m.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if(/labor|labour/.test(m) && amtMatch){
    return {reply:'Logging $'+amtMatch[1]+' labor'+(job_ref?(' on '+job_ref):'')+'.',intent:'labor',job_ref,target:'',amount:amtMatch[1]};
  }
  // assign a tech
  const tech=TECHS.find(t=>m.includes(t));
  if(tech && /(assign|give|send|put .* on|to )/.test(m)){
    return {reply:'Assigning '+cap(tech)+(job_ref?(' to '+job_ref):'')+'.',intent:'assign',job_ref,target:cap(tech),amount:''};
  }
  // move to a folder/status
  for(const [folder,re] of FOLDER_WORDS){
    if(re.test(m)){
      return {reply:'Moving'+(job_ref?(' '+job_ref):'')+' to '+label(folder)+'.',intent:'move',job_ref,target:folder,amount:''};
    }
  }
  if(/(find|search|look ?up|where|show|pull up|open)/.test(m) && job_ref){
    return {reply:'Looking up '+job_ref+'.',intent:'search',job_ref,target:'',amount:''};
  }
  return {reply:"Tell me what to move where — e.g. “move the Carson job to waiting parts”, “assign Jimmy to 18537”, or “log $140 labor on 18537”.",intent:'none',job_ref:'',target:'',amount:''};
}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function label(f){return {waiting_parts:'Waiting Parts',completed:'Completion',needs_scheduled:'Needs Scheduled',needs_invoice:'Needs Invoice',follow_up:'Follow Up'}[f]||f;}

async function parseWithClaude(msg){
  const key=process.env.ANTHROPIC_API_KEY;
  if(!key) return null;
  const sys='You are Ant, the office assistant for an appliance-repair company. The office manager talks in plain language to move jobs around her board and log info. '
    +'Parse her message into ONE action. Folders/statuses: needs_scheduled, waiting_parts, completed, follow_up, needs_invoice. Techs: Teddy, Jimmy, Andre, Lee, Billy, John. '
    +'Intents: move (change folder/status), assign (to a tech), labor (log a dollar labor amount), search (look up a job), none (unclear/just chatting). '
    +'job_ref = the job number OR customer name she names. target = folder/status (for move) or tech first name (for assign). amount = dollar number (for labor). '
    +'reply = one short friendly sentence confirming the action (or a clarifying question if intent=none). '
    +'Respond with STRICT JSON only: {"reply":"","intent":"","job_ref":"","target":"","amount":""}';
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
