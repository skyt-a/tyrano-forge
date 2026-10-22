; Blue Hour — TyranoForge の操作デモ
; 背景・本文・選択肢を編集して、プレビューで確かめられます。

*start
[cm]
[bg storage="harbor.svg" time="400"]
[position layer="message0" left="48" top="540" width="1184" height="132" frame="none" color="0x132438" opacity="230" margint="18" marginl="28" marginr="28"]
[layopt layer="message0" visible="true"]
[font size="26" color="0xF2F1E8" face="sans-serif"]
[tb_start_text mode="1"]
#案内人
夜の港へようこそ。[r]
ここから、あなただけの物語が始まります。[p]
[_tb_end_text]

[cm]
[glink text="海辺の道を歩く" target="*shore" x="340" y="380" width="280" size="24"]
[glink text="丘の天文台へ向かう" target="*tower" x="660" y="380" width="280" size="24"]
[s]

*shore|海辺の道
[cm]
[tb_start_text mode="1"]
#案内人
波の音をたどると、灯台の明かりが見えてきました。[p]
[_tb_end_text]
[jump target="*ending"]

*tower|丘の天文台
[cm]
[bg storage="observatory.svg" time="700"]
[tb_start_text mode="1"]
#案内人
星を結ぶように、次の場面をつないでみましょう。[p]
[_tb_end_text]
[jump target="*ending"]

*ending|デモの終わり
[cm]
[tb_start_text mode="1"]
#案内人
どちらの道にも、続きの一行が待っています。[p]
[_tb_end_text]
[s]
