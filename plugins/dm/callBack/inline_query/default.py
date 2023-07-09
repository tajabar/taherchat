# fileName: plugins/dm/callBack/inline_query/default.py
# copyright ©️ 2021 nabilanavab
fileName = "plugins/dm/callBack/inline_query/default.py"

from plugins.util    import *
from configs.db      import myID
from configs.config  import images
from lang            import langList
from pyrogram.types  import (InputTextMessageContent, InlineKeyboardMarkup,
                             InlineKeyboardButton, InlineQueryResultPhoto)

async def lang_cb(inline_query) -> list:
    try:
        lang_code = await getLang(inline_query.from_user.id)
        CHUNK, _ = await translate(text="inline_query", lang_code=lang_code)
        
        BUTTON1 = CHUNK['TOP']
        _lang = { langList[lang][1]:f"https://t.me/{myID[0].username}?start=-l{lang}" for lang in langList }
        BUTTON1.update(_lang)
        BUTTON1.update({"♻" : "-|refresh"})
        BUTTON1 = await createBUTTON(
            btn = BUTTON1,
            order = int(f"1{((len(BUTTON1)-2)//3)*'3'}{(len(BUTTON1)-2)%3}1")
        )
        answer = [
            InlineQueryResultPhoto(
                photo_url = "https://d.top4top.io/p_2618bs5ga1.png", reply_markup = BUTTON1,
                caption = CHUNK['capt'], description = CHUNK['des']
            ),
            InlineQueryResultPhoto(
                photo_url = "https://i.top4top.io/p_2618air4j1.png",
                reply_markup = InlineKeyboardMarkup(
                    [[
                        InlineKeyboardButton(
                            text = "♻️ بحث ♻️",
                            switch_inline_query_current_chat = ""
                        ),
                        InlineKeyboardButton(
                            text = "💖 شارك البحث 💖",
                            switch_inline_query = ""
                        )
                    ]]
                ),
                caption = "__ال ‘**♻️ بحث ♻️**’ هذا الاختيار يمكنك من بحث على كتب PDF في اي محادثة__,\n\n"
                          "__وبينما ‘**💖 شارك البحث 💖**’ هذة الخاصية تمكنك من اختيار مكان البحث__",
            )
        ]
        
        return answer
    except Exception as e:
      logger.debug(e)
