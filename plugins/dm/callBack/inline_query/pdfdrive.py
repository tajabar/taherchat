# fileName : plugins/dm/callBack/callback/inline_query/pdfdrive.py
# copyright ©️ 2021 nabilanavab
fileName = "plugins/dm/callBack/callback/inline_query/pdfdrive.py"

import requests
from configs.log     import log
from logger          import logger
from .               import inline_data
from pyrogram        import Client as ILovePDF
from pyrogram.types  import InlineKeyboardButton, InlineKeyboardMarkup

@ILovePDF.on_chosen_inline_result()
async def chosen_inline_result(bot, chosen_inline_result):
    try:
        data = inline_data[chosen_inline_result.from_user.id][int(chosen_inline_result.result_id)]
        log_msg = await bot.send_photo(
            chat_id = int(log.LOG_CHANNEL),
            photo = inline_data[chosen_inline_result.from_user.id][int(chosen_inline_result.result_id)]["thumb"],
            caption = f"🔗 **من:** `{chosen_inline_result.from_user.id}`\n"
                      f"**الاسم:** {chosen_inline_result.from_user.mention}\n"
                      f"**معرف:** @{chosen_inline_result.from_user.username}\n\n"
                      f"**عنوان:** °__{data['title']}__°\n"
                      f"**معلومات:** ¶__{data['span']}__¶\n"
                      f"**رابط:** •{data['href']}•\n",
            reply_markup = InlineKeyboardMarkup(
                [[
                    InlineKeyboardButton("✅ حظر ✅", callback_data = f"banC|{chosen_inline_result.from_user.id}")
                ]]
            )
        )
        
        await bot.edit_inline_caption(
            inline_message_id = chosen_inline_result.inline_message_id,
            caption = f"**ايدي**: __{data['id']}__\n"
                      f"**عنوان** : __{data['title']}__\n\n"
                      f"**معلومات:** __{data['span']}__\n",
            reply_markup = InlineKeyboardMarkup(
                [[
                    InlineKeyboardButton(text = "⚔ حصول على PDF ⚔", callback_data = f"pD|{log_msg.id}|{chosen_inline_result.from_user.id}"),
                    InlineKeyboardButton(text = "🔎 بحث 🔎", switch_inline_query_current_chat = f"{chosen_inline_result.query}")
                ],[
                    InlineKeyboardButton(text = "🔔 القناة 🔔", url = "https://telegram.dog/i2pdfbotchannel")
                ]]
            )
        )
        del inline_data[chosen_inline_result.from_user.id]
        
    except Exception as e:
        logger.exception("🐞 %s: %s" %(fileName, e), exc_info = True)
