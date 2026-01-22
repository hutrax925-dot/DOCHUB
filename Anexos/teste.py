import math
import random


class Neuron:
    """Neurônio simples com ativação sigmoid e treino por gradiente descendente."""

    def __init__(self, n_inputs, lr=0.1):
        self.w = [random.uniform(-1, 1) for _ in range(n_inputs)]
        self.b = random.uniform(-1, 1)
        self.lr = lr

    def _sigmoid(self, x):
        return 1.0 / (1.0 + math.exp(-x))

    def forward(self, x):
        s = sum(wi * xi for wi, xi in zip(self.w, x)) + self.b
        return self._sigmoid(s)

    def predict(self, x):
        return 1 if self.forward(x) >= 0.5 else 0

    def train(self, X, Y, epochs=10000, verbose=False):
        for e in range(epochs):
            total_loss = 0.0
            for x, y in zip(X, Y):
                pred = self.forward(x)
                # cross-entropy loss for binary output
                loss = -(y * math.log(pred + 1e-15) + (1 - y) * math.log(1 - pred + 1e-15))
                total_loss += loss

                # gradient of loss w.r.t linear output when using sigmoid + cross-entropy
                d = pred - y

                # update weights and bias
                for i in range(len(self.w)):
                    self.w[i] -= self.lr * d * x[i]
                self.b -= self.lr * d

            if verbose and (e % (epochs // 5 if epochs >= 5 else 1) == 0):
                print(f"Epoch {e}: loss={total_loss:.6f}")


def example_and_gate():
    # Treinar o neurônio para aprender a função AND (entradas binárias)
    X = [[0, 0], [0, 1], [1, 0], [1, 1]]
    Y = [0, 0, 0, 1]

    n = Neuron(n_inputs=2, lr=0.5)
    print("Pesos iniciais:", n.w, "bias:", n.b)
    n.train(X, Y, epochs=10000, verbose=True)
    print("Pesos finais:", n.w, "bias:", n.b)

    print("Resultados:")
    for x in X:
        print(x, "->", n.forward(x), "predição binária:", n.predict(x))


if __name__ == '__main__':
    example_and_gate()
