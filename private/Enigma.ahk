#Requires AutoHotkey v2.0
#SingleInstance Force
; Enigma Macros - animated interface.
; Uses the same Enigma.ini as the classic Enigma.ahk, so saved settings carry over.
; Do not run this and the classic script at the same time.
SendMode "Event"
SetKeyDelay 5, 5
SetMouseDelay 5

; ---------- make the Windows web control render in IE11 mode (needed for animations) ----------
EmuKey := "HKCU\Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION"
GpuKey := "HKCU\Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_GPU_RENDERING"
Exe := StrSplit(A_AhkPath, "\")[-1]
Cur := 0
try {
    Cur := RegRead(EmuKey, Exe)
} catch {
    Cur := 0
}
if Cur != 11001 {
    try {
        RegWrite(11001, "REG_DWORD", EmuKey, Exe)
        RegWrite(1, "REG_DWORD", GpuKey, Exe)
    } catch {
    }
    if A_Args.Length = 0 {
        Run('"' A_AhkPath '" "' A_ScriptFullPath '" emu')
        ExitApp
    }
}

; ---------- macro data and logic (same as the classic script) ----------
Active := true
Busy := false
Ini := A_ScriptDir "\Enigma.ini"
Slots := Map("sword", "1", "axe", "2", "mace", "3", "anchor", "4", "glowstone", "5", "pearl", "6", "windcharge", "7", "totem", "9", "crystal", "2", "obsidian", "3", "rail", "5", "cart", "6", "flint", "4", "crossbow", "4", "rod", "7", "gapple", "8", "bucket", "5", "hand", "f", "jump", "Space")
Macros := [
    {id:"hc", name:"Hit Crystal", tag:"HC", cat:"Crystal", desc:"Obsidian, crystal, then hit it", key:"Numpad1", ms:30, en:1, hold:0, steps:"s:obsidian rc s:crystal rc lc"},
    {id:"ac", name:"Auto Crystal", tag:"AC", cat:"Crystal", desc:"Hold the key to place and break crystals", key:"Numpad2", ms:8, en:1, hold:1, steps:"s:crystal rc lc"},
    {id:"sa", name:"Single Anchor", tag:"SA", cat:"Crystal", desc:"Place, charge, then detonate one anchor", key:"Numpad3", ms:27, en:1, hold:0, steps:"s:anchor rc s:glowstone rc s:totem rc"},
    {id:"da", name:"Double Anchor", tag:"DA", cat:"Crystal", desc:"Two anchors back to back", key:"Numpad4", ms:26, en:1, hold:0, steps:"s:anchor rc s:glowstone rc s:totem rc s:anchor rc s:glowstone rc s:totem rc"},
    {id:"ap", name:"Anchor Pearl", tag:"AP", cat:"Crystal", desc:"Anchor combo, then an instant pearl", key:"Numpad5", ms:25, en:1, hold:0, steps:"s:anchor rc s:glowstone rc s:totem rc s:pearl rc"},
    {id:"ot", name:"Offhand Totem", tag:"OT", cat:"Crystal", desc:"Swap a totem into your offhand", key:"Numpad6", ms:12, en:1, hold:0, steps:"s:totem f s:sword"},
    {id:"sb", name:"Shield Break", tag:"SB", cat:"Sword", desc:"Axe hit to disable the shield, back to sword", key:"Numpad7", ms:20, en:1, hold:0, steps:"s:axe lc s:sword"},
    {id:"jh", name:"Jump Hit", tag:"JH", cat:"Sword", desc:"Jump, then hit on the way down", key:"Numpad8", ms:250, en:1, hold:0, steps:"j lc"},
    {id:"sm", name:"Stun Slam", tag:"SM", cat:"Mace", desc:"Axe hit, then mace slam", key:"Numpad9", ms:20, en:1, hold:0, steps:"s:axe lc s:mace lc"},
    {id:"wb", name:"Wind Burst", tag:"WB", cat:"Mace", desc:"Wind charge boost, then mace in hand", key:"Numpad0", ms:30, en:1, hold:0, steps:"s:windcharge j rc s:mace"},
    {id:"fc", name:"Flint Cart", tag:"FC", cat:"Cart", desc:"Rail, TNT cart, light it with flint", key:"NumpadDot", ms:30, en:1, hold:0, steps:"s:rail rc s:cart rc s:flint rc"},
    {id:"cb", name:"Crossbow Cart", tag:"CB", cat:"Cart", desc:"Rail, TNT cart, fire the loaded crossbow", key:"NumpadAdd", ms:30, en:1, hold:0, steps:"s:rail rc s:cart rc s:crossbow rc"},
    {id:"rd", name:"Rod Combo", tag:"RD", cat:"UHC", desc:"Cast the rod, then back to sword", key:"NumpadSub", ms:40, en:1, hold:0, steps:"s:rod rc s:sword"},
    {id:"ga", name:"Golden Apple", tag:"GA", cat:"UHC", desc:"Eat a gapple, then back to sword", key:"NumpadMult", ms:10, en:1, hold:0, steps:"s:gapple eat s:sword"},
    {id:"bc", name:"Bucket Clutch", tag:"BC", cat:"UHC", desc:"Water bucket while falling (look down first)", key:"NumpadDiv", ms:10, en:1, hold:0, steps:"s:bucket rc"},
    {id:"kp", name:"Key Pearl", tag:"KP", cat:"UHC", desc:"Throw a pearl, return to sword", key:"NumpadEnter", ms:30, en:1, hold:0, steps:"s:pearl rc s:sword"}
]
Reg := []
ById := Map()

for m in Macros {
    m.key := IniRead(Ini, m.id, "key", m.key)
    m.ms := Integer(IniRead(Ini, m.id, "ms", m.ms))
    m.en := Integer(IniRead(Ini, m.id, "en", m.en))
    ById[m.id] := m
}
for k, v in Slots.Clone()
    Slots[k] := IniRead(Ini, "slots", k, v)

MC() => WinActive("ahk_exe javaw.exe") || WinActive("Minecraft")
InMC(*) => Active && Licensed && MC()

; ---------- license: the server checks your plan and expiry ----------
LicenseURL := "__LICENSE_BASE__/api/verify"
Licensed := false
LicKey := Trim(IniRead(Ini, "license", "key", ""))
LicPlan := ""
LicLifetime := 0
LicExpires := 0
LicOffset := 0
LicFail := 0
if !LicGate()
    ExitApp
SetTimer(LicTick, 60000)

Hotkey("Insert", Flip)
Rebind()

; ---------- window with the animated web interface ----------
Win := Gui("+AlwaysOnTop", "Enigma Macros")
Win.BackColor := "16110B"
WB := ""
try {
    WBC := Win.Add("ActiveX", "x0 y0 w900 h580", "Shell.Explorer")
    WB := WBC.Value
} catch {
    MsgBox("The Windows web control could not start. Please use the classic Enigma.ahk instead.", "Enigma Macros")
    ExitApp
}

mjs := ""
for m in Macros
    mjs .= "['" m.id "','" m.name "','" m.tag "','" m.cat "','" m.desc "','" m.key "'," m.ms "," m.en "],"
sjs := ""
for k, v in Slots {
    if k != "hand" && k != "jump"
        sjs .= "['" k "'," v "],"
}

Page := "
(
<!DOCTYPE html>
<html><head><meta http-equiv='X-UA-Compatible' content='IE=edge'><meta charset='utf-8'>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#16110b;color:#f4e8d3;font:14px 'Segoe UI',Arial,sans-serif;-ms-user-select:none;cursor:default}
.glow{position:absolute;border-radius:50%}
.g1{width:460px;height:460px;left:200px;top:-190px;background:radial-gradient(circle,rgba(245,165,36,.22),rgba(245,165,36,0) 65%);animation:fl 9s ease-in-out infinite alternate}
.g2{width:420px;height:420px;right:-150px;bottom:-150px;background:radial-gradient(circle,rgba(255,122,47,.18),rgba(255,122,47,0) 65%);animation:fl 11s ease-in-out infinite alternate-reverse}
@keyframes fl{to{transform:translate(40px,30px) scale(1.15)}}
#side{position:absolute;left:0;top:0;bottom:0;width:180px;background:#1d160d;border-right:1px solid #3a2c1b;padding:20px 12px}
.brand{display:flex;align-items:center;margin:0 0 22px 6px;font-weight:800;font-size:19px;color:#f5a524}
.logo{position:relative;width:24px;height:24px;margin-right:9px;background-image:url('data:image/png;base64,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');background-repeat:no-repeat;background-position:center;background-size:contain}
.logo:before{display:none}
@keyframes bob{to{transform:translateY(-3px) rotate(8deg)}}
.tab{position:relative;padding:9px 14px;margin-bottom:4px;border-radius:9px;color:#b5a38a;cursor:pointer;transition:background .2s,color .2s,padding-left .2s}
.tab:hover{background:#261c10;color:#f4e8d3;padding-left:20px}
.tab.on{background:#2c2114;color:#ffc766}
.tab.on:before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:2px;background:#f5a524;animation:bar .3s ease}
@keyframes bar{from{transform:scaleY(0)}}
#main{position:absolute;left:180px;top:0;right:0;bottom:0;padding:24px 26px}
#ttl{font-size:28px;font-weight:800}
.ul{height:3px;width:50px;margin-top:6px;border-radius:2px;background:linear-gradient(90deg,#f5a524,#ff7a2f);animation:gr 2.4s ease-in-out infinite alternate}
@keyframes gr{to{width:130px}}
#sub{margin-top:8px;color:#b5a38a;font-size:12px}
#st{position:absolute;right:26px;top:26px;padding:7px 16px;border-radius:99px;font-weight:700;cursor:pointer;background:#f5a524;color:#1a1000;transition:background .3s,color .3s}
#st.off{background:#3a2c1b;color:#b5a38a}
#st i{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:#1a1000;animation:pu 1.4s infinite}
#st.off i{background:#b5a38a;animation:none}
@keyframes pu{50%{opacity:.25}}
#rows{margin-top:18px}
.row{display:flex;align-items:center;justify-content:space-between;height:56px;margin-bottom:8px;padding:0 14px;border:1px solid #3a2c1b;border-radius:14px;background:#1f170e;animation:pop .45s ease backwards;transition:transform .2s,border-color .2s,box-shadow .2s}
.row:hover{transform:translateY(-2px);border-color:#f5a524;box-shadow:0 8px 22px rgba(0,0,0,.4)}
@keyframes pop{from{opacity:0;transform:translateY(14px)}}
.tag{flex:none;width:38px;height:38px;margin-right:14px;border-radius:10px;background:#3a2810;color:#ffc766;font-weight:800;font-size:12px;text-align:center;line-height:38px}
.info{flex:1;min-width:0}
.info b{display:block;font-size:14px}
.info span{display:block;color:#b5a38a;font-size:11px;white-space:nowrap}
.ctl{display:flex;align-items:center}
.key{min-width:100px;padding:6px 10px;margin-right:10px;border-radius:8px;border:1px solid #3a2c1b;background:#2c2114;color:#ffc766;text-align:center;font-size:12px;cursor:pointer;transition:border-color .2s}
.key:hover{border-color:#f5a524}
.key.wait{border-color:#f5a524;animation:bl .9s infinite}
@keyframes bl{50%{opacity:.35}}
.step{display:flex;align-items:center;border:1px solid #3a2c1b;border-radius:8px;background:#2c2114}
.step i{width:24px;padding:5px 0;font-style:normal;text-align:center;color:#ffc766;cursor:pointer;transition:background .15s}
.step i:hover{background:#3a2810}
.v{min-width:42px;text-align:center;color:#ffc766;font-size:12px;cursor:pointer}
.ctl small{margin:0 12px 0 6px;color:#b5a38a}
.sw{position:relative;width:42px;height:23px;border-radius:12px;background:#3a2c1b;cursor:pointer;transition:background .25s}
.sw:after{content:'';position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:left .25s}
.sw.on{background:#f5a524}
.sw.on:after{left:22px}
.slots .row{float:left;width:calc(50% - 6px);height:40px;margin-right:12px;margin-bottom:6px}
.slots .row:nth-child(2n){margin-right:0}
#foot{position:absolute;left:26px;bottom:14px;color:#7a6650;font-size:11px}
</style></head><body>
<div class='glow g1'></div><div class='glow g2'></div>
<div id='side'><div class='brand'><div class='logo'></div>Enigma</div><div id='tabs'></div></div>
<div id='main'><div id='ttl'>Crystal</div><div class='ul'></div><div id='sub'></div>
<div id='st' data-a='all'><i></i><span id='stt'>Macros ON</span></div>
<div id='rows'></div>
<div id='foot'>Insert turns all macros on/off. Runs only while Minecraft is active. Changes save automatically.</div></div>
<textarea id='br' style='display:none'></textarea>
<script>
var M=[@@M@@],S=[@@S@@],A=@@A@@;
var CATS=['Crystal','Sword','Mace','Cart','UHC','Slots'],cur='Crystal',rep=null,tmo=null;
function $(i){return document.getElementById(i)}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.appendChild(document.createTextNode(String(x)));return e}
function at(e,a,id,k){e.setAttribute('data-a',a);e.setAttribute('data-id',id);if(k)e.setAttribute('data-k',k);return e}
function send(c){$('br').value+=c+'\n'}
function mBy(id){for(var i=0;i<M.length;i++)if(M[i][0]==id)return M[i]}
function sBy(n){for(var i=0;i<S.length;i++)if(S[i][0]==n)return S[i]}
function stepper(id,v,k){var s=el('div','step');s.appendChild(at(el('i',0,'-'),'dn',id,k));var n=at(el('span','v',v),'askms',id,k);n.id='v_'+k+'_'+id;s.appendChild(n);s.appendChild(at(el('i',0,'+'),'up',id,k));return s}
function row(m,i){var r=el('div','row');r.style.animationDelay=(i*55)+'ms';r.appendChild(el('div','tag',m[2]));var f=el('div','info');f.appendChild(el('b',0,m[1]));f.appendChild(el('span',0,m[4]));r.appendChild(f);var c=el('div','ctl');var k=at(el('div','key',m[5]),'cap',m[0]);k.id='k_'+m[0];c.appendChild(k);c.appendChild(stepper(m[0],m[6],'m'));c.appendChild(el('small',0,'ms'));c.appendChild(at(el('div',m[7]?'sw on':'sw'),'tg',m[0]));r.appendChild(c);return r}
function srow(s,i){var r=el('div','row');r.style.animationDelay=(i*30)+'ms';var f=el('div','info');f.appendChild(el('b',0,s[0]));r.appendChild(f);var c=el('div','ctl');c.appendChild(stepper(s[0],s[1],'s'));r.appendChild(c);return r}
function render(){var i,t=$('tabs');t.innerHTML='';for(i=0;i<CATS.length;i++){t.appendChild(at(el('div',CATS[i]==cur?'tab on':'tab',CATS[i]),'tab',CATS[i]))}
$('ttl').innerHTML=cur;$('sub').innerHTML=cur=='Slots'?'Hotbar slot (1-9) used by each item':'Click a key to rebind it. Use - and + for the delay, or click the number to type it.';
var box=$('rows');box.innerHTML='';box.className=cur=='Slots'?'slots':'';
if(cur=='Slots'){for(i=0;i<S.length;i++)box.appendChild(srow(S[i],i))}else{var n=0;for(i=0;i<M.length;i++)if(M[i][3]==cur)box.appendChild(row(M[i],n++))}}
function find(e){e=e||window.event;var t=e.target||e.srcElement;while(t&&!(t.getAttribute&&t.getAttribute('data-a')))t=t.parentNode;return t}
function step(k,id,d){var v;if(k=='m'){var m=mBy(id);v=Math.max(0,Math.min(3000,m[6]+d));m[6]=v;send('ms|'+id+'|'+v)}else{var s=sBy(id);v=s[1]+d;if(v<1)v=9;if(v>9)v=1;s[1]=v;send('slot|'+id+'|'+v)}var e=$('v_'+k+'_'+id);if(e)e.firstChild.nodeValue=v}
function stop(){clearTimeout(tmo);clearInterval(rep)}
document.onmouseup=stop;
document.onmousedown=function(e){var t=find(e);if(!t)return;var a=t.getAttribute('data-a');if(a!='up'&&a!='dn')return;var k=t.getAttribute('data-k'),id=t.getAttribute('data-id'),d=a=='up'?1:-1;step(k,id,d);stop();tmo=setTimeout(function(){rep=setInterval(function(){step(k,id,d)},70)},380)};
document.onclick=function(e){var t=find(e);if(!t)return;var a=t.getAttribute('data-a'),id=t.getAttribute('data-id');
if(a=='tab'){cur=id;render()}
else if(a=='tg'){var m=mBy(id);m[7]=m[7]?0:1;t.className=m[7]?'sw on':'sw';send('en|'+id+'|'+m[7])}
else if(a=='cap'){t.className='key wait';t.firstChild.nodeValue='press a key...';send('cap|'+id)}
else if(a=='askms'&&t.getAttribute('data-k')=='m'){send('askms|'+id)}
else if(a=='all'){setActive(A?0:1);send('all|'+A)}};
function setKey(id,k){var m=mBy(id);if(k)m[5]=k;var e=$('k_'+id);if(e){e.className='key';e.firstChild.nodeValue=m[5]}}
function setMs(id,v){var m=mBy(id);m[6]=v;var e=$('v_m_'+id);if(e)e.firstChild.nodeValue=v}
function setActive(a){A=a;$('st').className=a?'':'off';$('stt').innerHTML=a?'Macros ON':'Macros OFF'}
setActive(A);render();
</script></body></html>
)"
Page := StrReplace(Page, "@@M@@", RTrim(mjs, ","))
Page := StrReplace(Page, "@@S@@", RTrim(sjs, ","))
Page := StrReplace(Page, "@@A@@", Active ? 1 : 0)

DllCall("dwmapi\DwmSetWindowAttribute", "ptr", Win.Hwnd, "int", 20, "int*", 1, "int", 4)
Win.OnEvent("Close", HideWin)
A_TrayMenu.Add("Show window", (*) => Win.Show())
A_TrayMenu.Add("License...", LicMenu)
A_TrayMenu.Default := "Show window"
Win.Show("w900 h580")
WB.Silent := true
WB.Navigate("about:blank")
t0 := A_TickCount
while WB.ReadyState != 4 && A_TickCount - t0 < 5000
    Sleep(20)
WB.document.write(Page)
WB.document.close()
SetTimer(Poll, 80)

; ---------- bridge between the web interface and the macros ----------
JS(code) {
    global WB
    try {
        WB.document.parentWindow.execScript(code)
    } catch {
    }
}

Poll() {
    global WB
    try {
        box := WB.document.getElementById("br")
        v := box.value
    } catch {
        return
    }
    if v = ""
        return
    box.value := ""
    for line in StrSplit(v, "`n", "`r") {
        if line = ""
            continue
        p := StrSplit(line, "|")
        cmd := p[1]
        if cmd = "ms" && p.Length >= 3 {
            m := ById.Get(p[2], "")
            if m {
                m.ms := Integer(p[3])
                QueueSave()
            }
        } else if cmd = "en" && p.Length >= 3 {
            m := ById.Get(p[2], "")
            if m {
                m.en := Integer(p[3])
                Rebind()
                QueueSave()
            }
        } else if cmd = "slot" && p.Length >= 3 {
            Slots[p[2]] := p[3]
            QueueSave()
        } else if cmd = "all" && p.Length >= 2 {
            SetActive(Integer(p[2]))
        } else if cmd = "cap" && p.Length >= 2 {
            Capture(p[2])
        } else if cmd = "askms" && p.Length >= 2 {
            AskMs(p[2])
        }
    }
}

AskMs(id) {
    m := ById.Get(id, "")
    if !m
        return
    Win.Opt("-AlwaysOnTop")
    r := InputBox("Delay in ms (0-3000)", "Enigma Macros", "w260 h130", m.ms)
    Win.Opt("+AlwaysOnTop")
    if r.Result = "OK" && RegExMatch(r.Value, "^\d{1,4}$") {
        m.ms := Integer(r.Value)
        QueueSave()
    }
    JS("setMs('" id "'," m.ms ")")
}

Capture(id) {
    m := ById.Get(id, "")
    if !m
        return
    ih := InputHook("T8")
    ih.KeyOpt("{All}", "E")
    ih.Start()
    got := ""
    while ih.InProgress {
        for b in ["XButton1", "XButton2", "MButton"] {
            if GetKeyState(b, "P")
                got := b
        }
        if got != ""
            break
        Sleep(15)
    }
    if got != ""
        ih.Stop()
    else if ih.EndKey != "" && ih.EndKey != "Escape"
        got := ih.EndKey
    if got != "" {
        m.key := got
        Rebind()
        QueueSave()
    }
    JS("setKey('" id "','" m.key "')")
}

HideWin(*) {
    Win.Hide()
    return 1
}

Flip(*) {
    SetActive(!Active)
}

SetActive(v) {
    global Active
    if v && !Licensed {
        TrayTip("Enigma Macros", "Your license is not active. Right click the tray icon > License to enter a key.")
        JS("setActive(0)")
        return
    }
    Active := v ? 1 : 0
    JS("setActive(" Active ")")
    TrayTip("Enigma Macros", Active ? "Macros ON" : "Macros OFF")
}

Rebind() {
    global Reg
    HotIf(InMC)
    for k in Reg {
        try {
            Hotkey("$" k, "Off")
        } catch {
        }
    }
    Reg := []
    for m in Macros {
        if m.en {
            try {
                Hotkey("$" m.key, Go.Bind(m), "On")
                Reg.Push(m.key)
            } catch {
            }
        }
    }
    HotIf()
}

QueueSave() {
    SetTimer(Save, -300)
}

Save() {
    for m in Macros {
        IniWrite(m.key, Ini, m.id, "key")
        IniWrite(m.ms, Ini, m.id, "ms")
        IniWrite(m.en, Ini, m.id, "en")
    }
    for k, v in Slots
        IniWrite(v, Ini, "slots", k)
}

Go(m, hk) {
    global Busy
    if Busy
        return
    Busy := true
    try {
        if m.hold {
            k := RegExReplace(hk, "^[~*$^+!#<>]+")
            while GetKeyState(k, "P") && Active && Licensed && MC()
                Steps(m)
        } else
            Steps(m)
    } catch {
    }
    Busy := false
}

Steps(m) {
    for t in StrSplit(m.steps, " ") {
        if SubStr(t, 1, 2) = "s:"
            Send("{" Slots[SubStr(t, 3)] "}")
        else if t = "rc"
            Click("Right")
        else if t = "lc"
            Click("Left")
        else if t = "f"
            Send("{" Slots["hand"] "}")
        else if t = "j"
            Send("{" Slots["jump"] "}")
        else if t = "eat" {
            Click("Right Down")
            Sleep(1650)
            Click("Right Up")
        }
        Sleep(m.ms)
    }
}

; ---------- license functions ----------
UnixNow() => DateDiff(A_NowUTC, "19700101000000", "Seconds")

HwidId() {
    id := ""
    try {
        SetRegView 64
        id := RegRead("HKLM\SOFTWARE\Microsoft\Cryptography", "MachineGuid")
    } catch {
        id := ""
    }
    SetRegView "Default"
    if id = ""
        id := A_ComputerName "-" A_UserName
    return RegExReplace(id, "[^\w\-\.]", "_")
}

LicCall(key) {
    body := '{"key":"' key '","hwid":"' HwidId() '"}'
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.SetTimeouts(5000, 5000, 8000, 8000)
    req.Open("POST", LicenseURL, false)
    req.SetRequestHeader("Content-Type", "application/json")
    req.Send(body)
    return req.ResponseText
}

; Returns "ok", "net" (server not reachable) or the server's reason: invalid, expired, revoked, hwid
LicApply(txt) {
    global Licensed, LicPlan, LicLifetime, LicExpires, LicOffset
    if !InStr(txt, '"ok":')
        return "net"
    if InStr(txt, '"ok":true') {
        Licensed := true
        LicPlan := RegExMatch(txt, '"plan":"([^"]*)"', &m) ? m[1] : ""
        LicLifetime := InStr(txt, '"lifetime":true') ? 1 : 0
        LicExpires := RegExMatch(txt, '"expires_at":(\d+)', &m) ? Integer(m[1]) : 0
        st := RegExMatch(txt, '"server_time":(\d+)', &m) ? Integer(m[1]) : 0
        LicOffset := st ? st - UnixNow() : 0
        return "ok"
    }
    reason := RegExMatch(txt, '"reason":"(\w+)"', &m) ? m[1] : "invalid"
    if reason = "rate"
        return "net"
    Licensed := false
    return reason
}

LicCheckNow(key) {
    txt := ""
    try {
        txt := LicCall(key)
    } catch {
        return "net"
    }
    return LicApply(txt)
}

LicText(r) {
    if r = "expired"
        return "Your plan has expired. Buy a new plan on the website, then try again."
    if r = "revoked"
        return "This license was revoked. Contact support on Discord."
    if r = "hwid"
        return "This key is bound to another PC. Reset the PC binding in your dashboard on the website."
    if r = "net"
        return "Could not reach the license server. Check your internet connection."
    return "That key is not valid. Copy it again from your dashboard."
}

LicNote() {
    if LicLifetime
        info := "never expires"
    else {
        s := LicExpires - (UnixNow() + LicOffset)
        info := Floor(s / 86400) "d " Floor(Mod(s, 86400) / 3600) "h left"
    }
    TrayTip("Enigma Macros", "License OK: " LicPlan " (" info ")")
}

; Asks for a key until the server accepts it. Returns true when licensed.
LicGate() {
    global LicKey
    if InStr(LicenseURL, "__LICENSE_BASE__") {
        MsgBox("This copy has no server address inside. Download the client again from your dashboard on the website.", "Enigma Macros", "Iconx")
        return false
    }
    msg := ""
    loop {
        if LicKey != "" {
            r := LicCheckNow(LicKey)
            if r = "ok" {
                IniWrite(LicKey, Ini, "license", "key")
                LicNote()
                return true
            }
            msg := LicText(r)
            if r = "net" {
                if MsgBox(msg, "Enigma Macros", "RC Iconx") = "Retry"
                    continue
                return false
            }
        }
        res := InputBox((msg != "" ? msg "`n`n" : "") "Enter your license key (looks like ENG-XXXX-XXXX-XXXX).", "Enigma Macros - License", "w400 h170")
        if res.Result != "OK"
            return false
        LicKey := RegExReplace(StrUpper(Trim(res.Value)), "\s")
        if !RegExMatch(LicKey, "^ENG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$") {
            msg := LicText("invalid")
            LicKey := ""
        }
    }
}

; Runs every minute: stops the macros on the exact expiry time, and asks the server every 10 minutes.
LicTick() {
    global Licensed, LicFail
    static n := 0
    if !Licensed
        return
    if !LicLifetime && LicExpires && UnixNow() + LicOffset >= LicExpires {
        LicDeny("expired")
        return
    }
    n += 1
    if n < 10
        return
    n := 0
    r := LicCheckNow(LicKey)
    if r = "ok" {
        LicFail := 0
        return
    }
    if r = "net" {
        LicFail += 1
        if LicFail >= 6
            LicDeny("net")
        return
    }
    LicDeny(r)
}

LicDeny(reason) {
    global Licensed
    Licensed := false
    SetActive(0)
    TrayTip("Enigma Macros", LicText(reason) "`nRight click the tray icon > License to continue.")
}

LicMenu(*) {
    if LicGate()
        SetActive(1)
}
