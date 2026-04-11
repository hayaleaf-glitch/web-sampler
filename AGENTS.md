# Solosola Web Sampler - AI Architecture Constitution

将来のAIエージェント、および自分自身へ。
このプロジェクトのコードを編集する際は、以下の「アーキテクチャ憲法」を絶対遵守すること。これに反する設計はデグレードとみなす。

## 1. Zustand Store を万物の中枢とする
全ての「アプリケーション状態」および「非同期・業務ロジック（Action）」は `src/store/useStore.js` に集約せよ。
- UIや他モジュールで発生したイベントは、直接 Store の Action（関数）を呼び出す。
- **Actionの役割**: データ通信（FirebaseManager等）を実行し、その結果をもって自身のStateを更新すること。

## 2. 命令的な描画・実行を禁止する（完全リアクティブ）
「Aの処理が終わったからBを再描画しろ」という命令的な関数呼び出し（例: `UIController.renderPads()` を手動で叩く）を禁止する。
- UIの更新は、全て `subscribeToStore` を介した「状態監視」によって自動的に発火させよ。
- **データ変更 $\rightarrow$ Subscribe発火 $\rightarrow$ UI更新** という一方向かつ自律的なフローを維持すること。

## 3. 中継役のバケツリレーを禁止する（脱・仲介者）
`main.js` や中間ファイルに複数のモジュールを跨ぐ「中継ロジック」を記述してはならない。
- 以前のような「UIからのコールバックを main.js で受け取って、それを Firebase に渡し、結果をまた UI に戻す」といったバケツリレーは廃止した。
- UIがStoreのデータを必要とするなら、UI自身が Store を購読せよ。

## 4. モジュールの責務を純化せよ
- **FirebaseManager**: 純粋な通信API。Promiseを返すのみ。アプリの状態やUIのことは一切知らない。
- **AudioEngine**: 音声信号処理に特化する。副作用としての描画などを行わない。
- **UIController**: DOM描画とイベント受付に徹する。複雑なロジックは持たず、StoreのActionをキックするだけにする。
- **main.js**: アプリ起動時の「初期化（Boot）」と「グローバルバインド」のみを担当する。

---

**遵守確認のステップ**: 
新しい機能を追加する前に「それはZustandのActionとして定義されているか？」「UIの更新はsubscribe経由か？」を自答せよ。
