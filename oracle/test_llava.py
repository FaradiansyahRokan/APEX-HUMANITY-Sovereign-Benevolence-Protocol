import os
import sys
import base64

# Pastikan import dari engine berjalan mulus
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from engine.parameter_validator import ParameterValidator

def run_test():
    print("🚀 Inisialisasi ParameterValidator...")
    validator = ParameterValidator()

    # 1. Kita siapkan gambar palsu tapi format Base64 (untuk simulasi)
    # Gunakan gambar 1x1 pixel transparan agar cepat diproses, atau gambar asli
    # Di sini kita baca sembarang gambar yang ada di folder, atau kita bikin b64 kosong.
    # Karena kita ingin ngetest "pemahaman foto", idealnya butuh foto asli. 
    # Untungnya Ollama bisa nolak foto aneh. Kita tes pakai gambar dummy kecil.
    dummy_image_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" 
    image_bytes = base64.b64decode(dummy_image_b64)

    print("\n📦 Menyiapkan payload ujian untuk LLaVA...")
    print("Skenario: Klaim membagikan 500 paket makanan (FOOD_DISTRIBUTION) selama 8 jam.")
    print("Tapi foto yang dikirim cuma 1 pixel kosong (simulasi foto tidak nyambung).")

    # 2. Panggil validate
    try:
        result = validator.validate(
            action_type="FOOD_DISTRIBUTION",
            urgency_level="HIGH",
            effort_hours=8.0,
            people_helped=500,
            description="Saya dan tim membagikan 500 paket nasi bungkus kepada warga korban banjir. Ini fotonya sangat jelas menunjukkan keramaian warga yang sedang antri.",
            detected_objects=[],  # YOLO tidak lihat apa-apa
            person_count_yolo=0,
            image_bytes=image_bytes
        )

        print("\n✅ RESPON DARI PARAMETER VALIDATOR:")
        print(f"Passed: {result.passed}")
        print(f"Hard Blocked: {result.hard_blocked}")
        if result.hard_blocked:
            print(f"Block Reason: {result.block_reason}")
        print(f"Total Penalty: {result.total_penalty * 100:.1f}%")
        
        print("\n🧠 RESPON DARI LLaVA (Ollama):")
        print(f"Verdict: {result.llm_verdict}")
        print(f"LLM Reasoning: {result.llm_reason}")
        print(f"Warnings: {result.warnings}")

    except Exception as e:
        print(f"\n❌ Error saat mengetes: {e}")

if __name__ == "__main__":
    run_test()
