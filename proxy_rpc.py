import socket
import threading

def handle_client(client_socket, target_host, target_port):
    target_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        target_socket.connect((target_host, target_port))
    except Exception as e:
        print(f"Gagal konek ke Avalanche (127.0.0.1:9654): {e}")
        client_socket.close()
        return

    def forward(src, dst):
        try:
            while True:
                data = src.recv(4096)
                if not data:
                    break
                dst.sendall(data)
        except:
            pass
        finally:
            src.close()
            dst.close()

    threading.Thread(target=forward, args=(client_socket, target_socket)).start()
    threading.Thread(target=forward, args=(target_socket, client_socket)).start()

def start_proxy():
    # Bind ke 0.0.0.0 agar bisa dilihat HP
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("0.0.0.0", 9655))
    server.listen(10)
    print("--------------------------------------------------")
    print("🚀 JEMBATAN RPC AKTIF!")
    print("Laptop (Lokal) : 127.0.0.1:9654")
    print("HP (Akses lewat): 192.168.1.9:9655")
    print("--------------------------------------------------")
    print("Silakan tambah jaringan di MetaMask HP pakai port 9655")
    
    while True:
        client_sock, addr = server.accept()
        handle_client(client_sock, "127.0.0.1", 9654)

if __name__ == "__main__":
    start_proxy()
