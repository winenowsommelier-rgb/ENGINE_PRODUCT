import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MASTERFILE = ROOT / "data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB - MR2026MAR31.csv"
OUTPUT = ROOT / "data/supplier-intake/supplier_trade_reference_starter.csv"

DRIVE_FOLDERS = [
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Ambrose (Update)", "1PSwToctW_fY7OzLSI3Sjk8wtw_3DgWgo"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Magic Postion (Update)", "1iB7-riCua_15DHWrTJxrIyk744oAVSQX"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "United Beverage (Update)", "143vg7UJaM4tQ7zz07IV7QbmKvfGOPbE-"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Great wine (Update)", "19Ui31gHAOefyBUUSXZd8h24HJ94vgkoX"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Central Wine (Update)", "1Gb1BaVrCHPEYv-W3a0kyJIrrYzi-cuYj"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Universal Wine (Update)", "1Xyku5M2wf-uXgmBDzYqIe8d-Bm4PyoX4"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Wine Pro (Update)", "1LCQLj1uzWLcW8Z4v_POGrxOaVsXESTlt"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Finesip & Mr.cru (Update)", "1k7tUN49uZXQzgBG6zx4QBHj7so0NMLoU"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Siam Winery (Update)", "1VoaBu04pnlRcr1l-O6MRQjeVaicvWVQz"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Italasia (Update)", "1e6nMYIH0DDeKdKq_8UFyoTi2j_s_rX3Q"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "IWS (Update RSP / waiting Pricelist)", "1SVb4AaB2WmsrDpWuZwurcIEgfTakDv_f"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Italthai (Update)", "14bFLOa82dqgfwmld9GhHQ-PKkAXK_-Td"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Granmonte (Update)", "135-vMXChl9n6O_Ifopo3c2JzYxnaOzaT"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "NEW! Kilo (update)", "1R9tuRviL80-Nh1DnOVXVzgaRt2o8B8sq"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Pinnacle gastro (Update)", "1LXcIsFohH0o1VzMH_iPsw1OH-2eK9ys3"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "R&D (Update)", "1c9EWmqDAqOo1WJzHrX42qjmozNQz9tA9"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Bootlegger (Premium Thai Brand) (Update)", "1cUk7TLqafMc4OxVCni-1OMOKO1LVbPHO"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Alchemy (Update)", "1fRGM7zt27No5H_ugwE5Um_lvKPpnIMSv"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "DAD (Update)", "1NfRxV0JNGKADFWZATsNIusMQ6IOiH4pA"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "MH Wine (Updated)", "1QMeNQq7Hlur18qCoHDh1NsVR1mFqQYA5"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "TWE (Penfolds)", "1w-3EJ2s3SqfdAgoCehU4u9vZunXBhSFy"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Vinobox", "1Xf5vm0qyVl83F2pKjmfFaVIyKrvEXDdr"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Brandconnect", "10OSWAhI7Kl1eBME65GLvthNXckXAIbsg"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Bacardi", "1LUS232nfIitUpgQaeFuBKkNPbvZ_mA6-"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Noble Marketing", "1-UNmG3vstrxkPdRMAwwdnQMBZDJ0Nf2Z"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Ideal Wine", "1WmAvF3v475IOiTTVbvX-QD4ou0DuvVVU"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Thaibev", "1Uvj_EhRdnFDqSJP3SqLXnAI17oHoXey-"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Khaohom", "18AFlvkLgNqVG67TT-KiNBmGvR3bpw82M"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Sake merchant", "1_jyQFx2sUA_nx6rBqsxV65zGRR9dh6fo"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "EU Wine", "12WBo4skWfRlqPx6rzzLE4CfU5zrKgPpc"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Life Elixir", "1HAUgIfvtz5ElkdGCeRkoMagg9Co2u1zT"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "One Bev .Co.,Ltd", "1OAfmH4tX7ntfmZ6coXmwX5JWQhMaekdZ"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Diageo", "1jH9zp4BGyV94apeYGkZFl9BaUUMPWFIw"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Smiling Dark House (Wine)", "1Uod9OZ0q3D-YUfzNEtisWIy-_fyK4Ik7"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "Gfour", "1bjvhxfrl8j_7diJJUgYSLJgL8UaKsOgg"),
    ("rsp_price", "1.RSP PRICE", "1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY", "NEW! Exquisite elixir", "1XhaO2gm-6iFjlgiWrajw8cY-nUJ_SyD2"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "SCS (E-Shochu) (Update)", "10aq3LGmAodYuEiGareKsHCW3IyNcXPV-"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "SK Liqour (Update)", "1yp0g4ree4q3qyiufOchutbWS4wWsfosX"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Orion Fine Wine (Update)", "10nL7Fml-Ucass5QdJxUrvnvRhUlxnUAe"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "TA Beverage (Update)", "1ck8ikuAZ0gJZy5d_X2t95-XtUarvwcTy"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Primal Product (Update)", "1ZiUqqK9s-RuIVbrwMzlph-qEPszDMFpj"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Boozia (Update)", "1JplHIz1pDTHUJoNF_BfU7xDvN_gHAFnd"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Wine 5 (Update)", "17AjBk_s9xNmsm65kY74iF8lVO96iB1n2"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Wine Diva (Update)", "18qffz3N6GAb1CFil-1y6vVYB1w12w1VN"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "IQ Wine (Update)", "1SqN1pWUtWXTf-_BjlFpQW1OCYRENQBCP"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "The Best Provider (Update)", "1slC6C5jEsH2QGg1ioBGEcHt-9rGz7s5_"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Wine Direct (Update)", "1VW8RetcPJBbekfDmOmOsBZAqzrboykAl"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Bacchus Global (Update)", "1lcLbXnkvH4jObUswnvxnfiFGWjq5_re8"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Wine merchant (Update)", "1x-3rYKb09c8Qctnstn3S7Uu9ZFzHS5H4"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Lovely Wine (Update)", "1bYggkGN36p6TtN0DVKXTUlK0NDdO4IYI"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Texica (Update)", "1BKwmGgu8snTWswNNz7OexU7fUH8cqmxa"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Vanichwathana (Update)", "1TDJL4bBG_VUEzZjDjSxaVULheI-CXCtu"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "JDSS (ไวน์ลด20% วิสกี้ลด10%) Update", "1ByESydr6Ss6_Hh7JUJJhBBnA9jvRxmPX"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Valentien Wine (Update)", "1gUeQdDx5PQfHwGsa5nJwSmNCq_7aj5gB"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "LUXE Wine (Update)", "1Zl7-7iQ3OjV20ZrpUFz-vmlWLrJuorzz"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "BB&B", "1aVFftSTY1K2TvzfKfiwFvjc9uVjXLFiD"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Blue Moon", "14yqwnX1aI_jKom405dgkGRyzffM8tJd0"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Enoteca", "1G65O0pB9fD8MsZ8ktoe_3gDRg5agihGj"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "B Delicious", "1kCupdL7DDr60q3aQacTmYWx5LwX9E98a"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Estella Wine", "1uen8PmYnblV3pDTFSqK9ifi3Li9MKvqu"),
    ("no_rsp_price", "2. NO RSP PRICE", "132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf", "Jigger", "1mWaGWrzhpaTLazdBJBiB13O6g5Wus20e"),
    ("retail_cash_store", "3.Retail Supplier (Cash on store)", "1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz", "Somphop (Update)", "1IzXabQt-KXgAO8rJBV8bGvima3WjkA0Y"),
    ("retail_cash_store", "3.Retail Supplier (Cash on store)", "1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz", "Surawong Store (Update)", "1diYjYahAM85D0MEktJGkYg2CBytY8uWX"),
    ("retail_cash_store", "3.Retail Supplier (Cash on store)", "1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz", "Chalamnimit (Update)", "1I-6ugxQ7ooFXkRuBixSKcFb9Icmnm7Hg"),
]

SUPPLIER_DETAILS_TEXT = """
AA\tItalasia Head Office (-30%)
AA2\tItalasia (Spirits) (-15%)
AA4\tItalasia (Premium Wine) (-15%)
AB\tBB&B (Wine) (-15%)
AB2\tBB&B (Liquor) (-10%)
AB3\tBB&B (Glassware)
AC\tUniversal Fine Wine & Spirit
AC2\tEU Wine Co.,Ltd.
AD\tIWS
AE\tGfour
AE4\tBrandconnect Thailand
AF\tVanichwattana
AH\tAmbrose
AI\tGlobal Food Products
AJ\tLovely Wine
AK\tSibour
AM\tD-Wine
AN\tBrewberry
AP\tPacer Grow
AR\tSCS Trading
AU\tSmiling Mad Dog
AU2\tSmiling Dark House
AV\tDrinkwise
AX\tFlow Inter Co., Ltd.
BD\tOceanglass
BG\tMini bar services (Thailand)
BH\tW.kiert & Fuji Co., Ltd.
BJ\tYongchien Intertrade
BK\tAPHI Enterprise
BL\tPacific B&B
BM\tEuropean Manufacturers United
BN\tIQ Wine CO.,Ltd.
BQ\tInternational Beverage
BR\tGreat Earth International Company Limited
BS\tTexica Co., Ltd (Head Office)
BT\tThe Pacific Cigar (Thailand) co.,ltd (Cigar)
BT2\tThe Pacific Cigar (Thailand) co.,ltd (Whisky)
BT3\tThe Pacific Cigar (Thailand) co.,ltd (Sake&Shochu)
BU(11)\tSomphop Liquor
BU\tSuriwongse Store (OTHER)
BU(2)\tSuriwongse Store (OTHER)
BU(4)\tSuriwongse Store (Pernod Ricard)
BU-VV\tVim&Vigor (Consignment)
BU(8)\tห้างหุ้นส่วน แฉล้มนิมิต (Diageo)
BU(9)\tSuriwongse Store (Brown-Forman)
BX\tBeervana (Thailand) Co.,Ltd.
CA\tThe Bottles Co., Ltd.
CB\tBoozia Distribution Co., Ltd.
CC\t2 Remedy Thailand Company Limited
CE\tCrave Beverage Co.,Ltd.
CH\tSiam Winery
CI\tCorner Stone (ทรีไลน์)
CN\tAlchemy Thailand
CP\tSomphop Liquor
CQ\tJiggers Co.,Ltd.
CS\tHacklberg Thailand
CT\tPerfetto Foods
CU\tJiamphattana Food And Beverage Co.,Ltd.
CW\tFusion Providores International Facilitation
CY\tThe Matter of Taste Co., Ltd.
DA\tSerenity Wines
DB\tBacchus Global
DD\tNoble Marketing
DD(2)\tNoble Marketing (Consignment)
DE\tPrimator (Thailand) Co., Ltd.
DG\tPremium Thai Brand Co.Ltd
DH\tEstella Company Limited
DJ\tWine 5 Co.,Ltd.
DJ(2)\tWine 5 Co.,Ltd. (Consignment)
DK\tRiesling & Co Co., Ltd.
DN\tFizz Boyz Co., Ltd.
DP\tSilver Lake
DR\tIWS - Bacardi (Thailand)
DT\tYummy House
DU\tSan Miguel Thailand
DW\tT/A Beverage
DY\tTempTech (Thailand) Co., Ltd.
EC\tGLOBO Internacional
ED\tWINE IS WINE CO., LTD.
EF\tPrimal Product
EG\tWine Direct (Thailand)
EH\tTerroir Wines
EI\tPinnacle Gastro
EJ\tDometic
EK\tCote d Azur Spirits
EL\tIntershinningline
EM\tForteway Food&Beverage
EN\tVerasu
EP\tRepour thailand
EQ\tUnited Beverage
ER\tMagic Potion Ltd.
ER2\tVinelentine
ES\tThai Beverage
EW\tSophienwald
EX\tPulmentum Co., Ltd.
FA\tMC GLOBIZ CO.,LTD.
FC\tValentine Wines
FD\tLittle Gourmandises
FJ(2)\tItalthai (Consignment)
FK\tP.K.C. Project Management Co.,Ltd. (Consignment)
FL\tAVIVA (Consignment)
FM\tKantina
FN\tEnoteca
FO\tWine Merchant
FP\tCentral Retail
FR\tWINE PRO
FR(2)\tWINE PRO (Consignment)
FS\tSK Liquor
FT\tLUXE WINE
FU\tWine Diva (Consignment)
FV\tOuranos BKK (Consignment)
FW\tKeith and Kym
FX\tGranmonte
FX(2)\tGranmonte (Consignment)
FY\tMotavi Co Ltd
GA\tConnect Asia
GB\tWOLB ENTERPRISE CO., LTD
GB(2)\tWOLB ENTERPRISE CO., LTD (Consignment)
GC\tFinesip
GE\tGreat Wine (Thailand) Company Limited
GF\tCreative Bottles Asia Pacific
GG\tP.U.R. Distillery Co. Ltd. (Head Office)
GI\tWine Pilot
GK\tAsura Beverage (Consignment)
GL\tRoyal Gateway
GM\tBaeksan
GN\tMR.CRU
GQ\tNoble Wine (Consignment)
GR\tInchon distillery (Consignment)
GS\tYummy Greece
GT\tRD Wine Consulting (Consignment)
GU\tOne Bev .Co.,Ltd (Consignment)
GV\tK.R.INTERTRADE 2017 CO.,LTD
GW\tIdeal Wine
GW(2)\tIdeal Wine (Consignment)
GX\tDouble A Distribution Co., Ltd. (D.A.D.)
HC\tVim&Vigor (Consignment)
HC-CEL\tเซเลสเทียร์ (Consignment)
HD\tThe Sake Merchant
HE\tบริษัท วินเนอร์โฮม จำกัด (Consignment)
HF\tOnson (Consignment)
HI\tOrion Fine Wines (-10%)
HK\texquisiteelixir
HK(2)\texquisiteelixir (Consignment)
HM\tJDSS
HP\tJDSS
WN\tWine-now
"""

MANUAL_FOLDER_MATCH = {
    "AA": "Italasia (Update)",
    "AA2": "Italasia (Update)",
    "AA4": "Italasia (Update)",
    "AB": "BB&B",
    "AB2": "BB&B",
    "AB3": "BB&B",
    "AC": "Universal Wine (Update)",
    "AC2": "EU Wine",
    "AD": "IWS (Update RSP / waiting Pricelist)",
    "AE": "Gfour",
    "AE4": "Brandconnect",
    "AF": "Vanichwathana (Update)",
    "AH": "Ambrose (Update)",
    "AJ": "Lovely Wine (Update)",
    "AR": "SCS (E-Shochu) (Update)",
    "AU2": "Smiling Dark House (Wine)",
    "BN": "IQ Wine (Update)",
    "BS": "Texica (Update)",
    "CB": "Boozia (Update)",
    "CH": "Siam Winery (Update)",
    "CN": "Alchemy (Update)",
    "CP": "Somphop (Update)",
    "CQ": "Jigger",
    "DB": "Bacchus Global (Update)",
    "DD": "Noble Marketing",
    "DD(2)": "Noble Marketing",
    "DG": "Bootlegger (Premium Thai Brand) (Update)",
    "DH": "Estella Wine",
    "DJ": "Wine 5 (Update)",
    "DJ(2)": "Wine 5 (Update)",
    "DR": "Bacardi",
    "DW": "TA Beverage (Update)",
    "EF": "Primal Product (Update)",
    "EG": "Wine Direct (Update)",
    "EI": "Pinnacle gastro (Update)",
    "EQ": "United Beverage (Update)",
    "ER": "Magic Postion (Update)",
    "ER2": "Valentien Wine (Update)",
    "ES": "Thaibev",
    "FC": "Valentien Wine (Update)",
    "FJ(2)": "Italthai (Update)",
    "FN": "Enoteca",
    "FO": "Wine merchant (Update)",
    "FR": "Wine Pro (Update)",
    "FR(2)": "Wine Pro (Update)",
    "FS": "SK Liqour (Update)",
    "FT": "LUXE Wine (Update)",
    "FU": "Wine Diva (Update)",
    "FX": "Granmonte (Update)",
    "FX(2)": "Granmonte (Update)",
    "GC": "Finesip & Mr.cru (Update)",
    "GE": "Great wine (Update)",
    "GN": "Finesip & Mr.cru (Update)",
    "GU": "One Bev .Co.,Ltd",
    "GW": "Ideal Wine",
    "GW(2)": "Ideal Wine",
    "GX": "DAD (Update)",
    "HD": "Sake merchant",
    "HI": "Orion Fine Wine (Update)",
    "HK": "NEW! Exquisite elixir",
    "HK(2)": "NEW! Exquisite elixir",
    "HM": "JDSS (ไวน์ลด20% วิสกี้ลด10%) Update",
    "HP": "JDSS (ไวน์ลด20% วิสกี้ลด10%) Update",
    "BU(11)": "Somphop (Update)",
    "BU": "Surawong Store (Update)",
    "BU(2)": "Surawong Store (Update)",
    "BU(4)": "Surawong Store (Update)",
    "BU(8)": "Chalamnimit (Update)",
    "BU(9)": "Surawong Store (Update)",
}


def num(value):
    text = str(value or "").replace(",", "").replace("%", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_supplier_name(title):
    text = re.sub(r"\s*\((?:update|updated).*?\)\s*", "", title, flags=re.I)
    text = re.sub(r"^NEW!\s*", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def norm(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


STOPWORDS = {
    "co", "ltd", "limited", "company", "thailand", "thai", "head", "office",
    "consignment", "wine", "wines", "liquor", "spirit", "spirits", "beverage",
    "update", "updated", "the", "and", "of", "by", "premium", "brand",
}


def parse_supplier_details():
    suppliers = []
    for line in SUPPLIER_DETAILS_TEXT.strip().splitlines():
        if not line.strip():
            continue
        code, detail = line.split("\t", 1)
        suppliers.append({
            "supplier_code": code.strip(),
            "supplier_detail": detail.strip(),
        })
    return suppliers


def metric_code_for_supplier_code(code):
    cleaned = re.sub(r"[^A-Za-z0-9]", "", code).upper()
    if len(cleaned) >= 2:
        return cleaned[:2]
    return cleaned


def extract_terms(detail):
    discounts = re.findall(r"-\s*\d+(?:\.\d+)?%", detail)
    tags = []
    if "consignment" in detail.lower():
        tags.append("Consignment")
    if discounts:
        tags.extend(discounts)
    return "; ".join(tags)


def drive_folder_index():
    return {
        folder_name: {
            "drive_pricing_structure": structure,
            "drive_bucket_name": bucket_name,
            "drive_bucket_folder_id": bucket_id,
            "drive_supplier_folder_name": folder_name,
            "drive_supplier_folder_id": folder_id,
            "drive_supplier_folder_url": f"https://drive.google.com/drive/folders/{folder_id}",
        }
        for structure, bucket_name, bucket_id, folder_name, folder_id in DRIVE_FOLDERS
    }


def find_drive_match(supplier_code, supplier_detail, folders_by_name):
    manual = MANUAL_FOLDER_MATCH.get(supplier_code)
    if manual and manual in folders_by_name:
        return folders_by_name[manual], "mapped_manual"

    return None, "needs_drive_folder_mapping"


def candidate_drive_folders_for_supplier(supplier_detail, folders_by_name):
    detail_tokens = {
        token for token in norm(supplier_detail).split()
        if token not in STOPWORDS and len(token) >= 3
    }
    if not detail_tokens:
        return ""
    candidates = []
    for folder_name, folder in folders_by_name.items():
        folder_tokens = {
            token for token in norm(clean_supplier_name(folder_name)).split()
            if token not in STOPWORDS and len(token) >= 3
        }
        overlap = detail_tokens & folder_tokens
        if not overlap:
            continue
        candidates.append((len(overlap), folder["drive_bucket_name"], folder_name))
    candidates.sort(key=lambda item: (-item[0], item[1], item[2]))
    return "; ".join(f"{folder_name} [{bucket}]" for _, bucket, folder_name in candidates[:5])


def load_suffix_metrics():
    by_suffix = defaultdict(lambda: {
        "product_count": 0,
        "margin_sum": 0.0,
        "margin_count": 0,
        "sales_qty_2026": 0.0,
        "sales_orders_2026": 0.0,
        "brands": Counter(),
        "sample_skus": [],
    })

    with MASTERFILE.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip()
            if len(sku) < 2:
                continue
            suffix = sku[-2:].upper()
            if not re.match(r"^[A-Z0-9]{2}$", suffix):
                continue

            bucket = by_suffix[suffix]
            bucket["product_count"] += 1

            margin = num(row.get("Margin %"))
            if margin is None:
                price = num(row.get("price"))
                cost = num(row.get("cost"))
                if price and cost:
                    margin = ((price - cost) / price) * 100
            if margin is not None:
                bucket["margin_sum"] += margin
                bucket["margin_count"] += 1

            bucket["sales_qty_2026"] += num(row.get("Sold Qty Mar")) or 0
            bucket["sales_orders_2026"] += num(row.get("Sold order Mar")) or 0

            brand = (row.get("brand") or "").strip()
            if brand:
                bucket["brands"][brand] += 1
            if len(bucket["sample_skus"]) < 8:
                bucket["sample_skus"].append(sku)

    return by_suffix


def candidate_codes_for_folder(folder_name, suffix_metrics):
    base = norm(clean_supplier_name(folder_name))
    if not base:
        return ""
    candidates = []
    for suffix, metrics in suffix_metrics.items():
        for brand, count in metrics["brands"].most_common(12):
            brand_norm = norm(brand)
            if len(brand_norm) >= 4 and (brand_norm in base or base in brand_norm):
                candidates.append((suffix, count))
                break
    candidates.sort(key=lambda item: item[1], reverse=True)
    return "; ".join(f"{suffix} ({count})" for suffix, count in candidates[:5])


def main():
    suffix_metrics = load_suffix_metrics()
    supplier_details = parse_supplier_details()
    folders_by_name = drive_folder_index()
    matched_folder_names = set()
    supplied_metric_codes = set()
    rows = []
    fieldnames = [
        "row_type",
        "mapping_status",
        "supplier_name",
        "supplier_detail",
        "supplier_code",
        "sku_metric_code_used",
        "trade_terms_from_name",
        "drive_pricing_structure",
        "drive_bucket_name",
        "drive_bucket_folder_id",
        "drive_supplier_folder_name",
        "drive_supplier_folder_id",
        "drive_supplier_folder_url",
        "possible_drive_folder_candidates",
        "possible_sku_code_candidates",
        "product_count",
        "avg_margin_pct_2026",
        "sales_qty_2026",
        "sales_orders_2026",
        "sales_data_source",
        "top_brands_from_sku_code",
        "sample_skus",
        "validation_notes",
        "notes",
    ]

    for supplier in supplier_details:
        code = supplier["supplier_code"]
        detail = supplier["supplier_detail"]
        metric_code = metric_code_for_supplier_code(code)
        supplied_metric_codes.add(metric_code)
        metrics = suffix_metrics.get(metric_code)
        folder, status = find_drive_match(code, detail, folders_by_name)
        if folder:
            matched_folder_names.add(folder["drive_supplier_folder_name"])

        avg_margin = ""
        product_count = ""
        sales_qty = ""
        sales_orders = ""
        top_brands = ""
        sample_skus = ""
        if metrics:
            product_count = metrics["product_count"]
            if metrics["margin_count"]:
                avg_margin = round(metrics["margin_sum"] / metrics["margin_count"], 2)
            sales_qty = int(metrics["sales_qty_2026"]) if metrics["sales_qty_2026"].is_integer() else round(metrics["sales_qty_2026"], 2)
            sales_orders = int(metrics["sales_orders_2026"]) if metrics["sales_orders_2026"].is_integer() else round(metrics["sales_orders_2026"], 2)
            top_brands = "; ".join(f"{brand} ({count})" for brand, count in metrics["brands"].most_common(8))
            sample_skus = "; ".join(metrics["sample_skus"])

        rows.append({
            "row_type": "supplier_code",
            "mapping_status": status if folder else "needs_drive_folder_mapping",
            "supplier_name": re.sub(r"\s*\([^)]*\)", "", detail).strip(),
            "supplier_detail": detail,
            "supplier_code": code,
            "sku_metric_code_used": metric_code,
            "trade_terms_from_name": extract_terms(detail),
            "drive_pricing_structure": folder["drive_pricing_structure"] if folder else "",
            "drive_bucket_name": folder["drive_bucket_name"] if folder else "",
            "drive_bucket_folder_id": folder["drive_bucket_folder_id"] if folder else "",
            "drive_supplier_folder_name": folder["drive_supplier_folder_name"] if folder else "",
            "drive_supplier_folder_id": folder["drive_supplier_folder_id"] if folder else "",
            "drive_supplier_folder_url": folder["drive_supplier_folder_url"] if folder else "",
            "possible_drive_folder_candidates": "" if folder else candidate_drive_folders_for_supplier(detail, folders_by_name),
            "possible_sku_code_candidates": "",
            "product_count": product_count,
            "avg_margin_pct_2026": avg_margin,
            "sales_qty_2026": sales_qty,
            "sales_orders_2026": sales_orders,
            "sales_data_source": "MR2026MAR31 masterfile: Sold Qty Mar / Sold order Mar only; use as current-period 2026 starter, not full-year sales." if metrics else "",
            "top_brands_from_sku_code": top_brands,
            "sample_skus": sample_skus,
            "validation_notes": "Validated by explicit manual mapping table." if folder else "No safe folder mapping. Candidate folders are suggestions only.",
            "notes": "Authoritative supplier detail supplied by user. Metric code uses first two alphanumeric chars of supplier code for variants like AA2 or BU(11).",
        })

    for structure, bucket_name, bucket_id, folder_name, folder_id in DRIVE_FOLDERS:
        if folder_name in matched_folder_names:
            continue
        rows.append({
            "row_type": "unmapped_drive_folder",
            "mapping_status": "needs_supplier_code_mapping",
            "supplier_name": clean_supplier_name(folder_name),
            "supplier_detail": "",
            "supplier_code": "",
            "sku_metric_code_used": "",
            "trade_terms_from_name": "",
            "drive_pricing_structure": structure,
            "drive_bucket_name": bucket_name,
            "drive_bucket_folder_id": bucket_id,
            "drive_supplier_folder_name": folder_name,
            "drive_supplier_folder_id": folder_id,
            "drive_supplier_folder_url": f"https://drive.google.com/drive/folders/{folder_id}",
            "possible_drive_folder_candidates": "",
            "possible_sku_code_candidates": candidate_codes_for_folder(folder_name, suffix_metrics),
            "product_count": "",
            "avg_margin_pct_2026": "",
            "sales_qty_2026": "",
            "sales_orders_2026": "",
            "sales_data_source": "",
            "top_brands_from_sku_code": "",
            "sample_skus": "",
            "validation_notes": "Folder exists in Drive but has no explicit supplier-code mapping yet.",
            "notes": "Drive folder found but not matched to supplied supplier code list.",
        })

    for suffix, metrics in sorted(suffix_metrics.items()):
        if suffix in supplied_metric_codes:
            continue
        avg_margin = ""
        if metrics["margin_count"]:
            avg_margin = round(metrics["margin_sum"] / metrics["margin_count"], 2)
        rows.append({
            "row_type": "unmapped_sku_suffix",
            "mapping_status": "needs_supplier_detail",
            "supplier_name": "",
            "supplier_detail": "",
            "supplier_code": "",
            "sku_metric_code_used": suffix,
            "trade_terms_from_name": "",
            "drive_pricing_structure": "",
            "drive_bucket_name": "",
            "drive_bucket_folder_id": "",
            "drive_supplier_folder_name": "",
            "drive_supplier_folder_id": "",
            "drive_supplier_folder_url": "",
            "possible_drive_folder_candidates": "",
            "possible_sku_code_candidates": "",
            "product_count": metrics["product_count"],
            "avg_margin_pct_2026": avg_margin,
            "sales_qty_2026": int(metrics["sales_qty_2026"]) if metrics["sales_qty_2026"].is_integer() else round(metrics["sales_qty_2026"], 2),
            "sales_orders_2026": int(metrics["sales_orders_2026"]) if metrics["sales_orders_2026"].is_integer() else round(metrics["sales_orders_2026"], 2),
            "sales_data_source": "MR2026MAR31 masterfile: Sold Qty Mar / Sold order Mar only; use as current-period 2026 starter, not full-year sales.",
            "top_brands_from_sku_code": "; ".join(f"{brand} ({count})" for brand, count in metrics["brands"].most_common(8)),
            "sample_skus": "; ".join(metrics["sample_skus"]),
            "validation_notes": "SKU suffix exists in masterfile but is not in the supplied supplier-code list.",
            "notes": "SKU suffix exists in product data but was not present in supplied supplier detail list.",
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(OUTPUT)
    print(f"supplier_code_rows={len(supplier_details)}")
    print(f"unmapped_drive_folder_rows={sum(1 for r in rows if r['row_type'] == 'unmapped_drive_folder')}")
    print(f"unmapped_sku_suffix_rows={sum(1 for r in rows if r['row_type'] == 'unmapped_sku_suffix')}")
    print(f"total_rows={len(rows)}")


if __name__ == "__main__":
    main()
